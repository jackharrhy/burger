/**
 * Authoritative server model, the server is the
 * single source of truth for all game state.
 *
 * 1. INPUT PROCESSING
 *    Clients send input commands. The server validates each one (see
 *    input-validation.ts), rejects malformed/replayed messages, and
 *    queues up to 128 deep per connection. Each tick processes at most
 *    MAX_INPUTS_PER_TICK so a flooding client cannot speed-hack.
 *    Each input has a sequence number for acknowledgment.
 *
 * 2. AUTHORITATIVE PHYSICS
 *    The server runs physics at (TICK_RATE)hz at fixed SERVER_TICK_RATE_MS dt.
 *    All position/velocity updates happen here.
 *
 * 3. STATE BROADCAST
 *    Every tick, the server broadcasts GAME_STATE to all clients.
 *    This includes position, velocity, and last-acknowledged input seq.
 *    Clients use this to reconcile their predictions.
 *
 * 4. ENTITY SYNCHRONIZATION
 *    - SNAPSHOT: Full world state sent on connect (structural + SoA data)
 *    - OBSERVER: Delta updates for entity add/remove (purely structural)
 *    - SOA:      Field-data deltas following an OBSERVER add. The bitecs
 *                observer stream doesn't carry field values, so we follow
 *                up with a SoA payload covering entities marked dirty via
 *                markEntityDirty().
 *    - GAME_STATE: Authoritative positions (player movement, every tick)
 *    - YOUR_EID: Sent on connect with [PROTOCOL_VERSION, eid, bounds.x,
 *      bounds.y, bounds.w, bounds.h]; clients verify the version, attach
 *      bounds to their world, and disconnect on version mismatch.
 *
 * 5. PAINT (admin only)
 *    Admins can place/erase tiles via PAINT messages. Each paint is
 *    validated (paint-validation.ts), gated on isAdmin, capped to
 *    MAX_PAINTS_PER_TICK per connection per tick, persisted to SQLite
 *    via paint.ts. Erase + replace produce RemoveEntity/AddEntity
 *    observer events; new tile entities are also marked dirty so the next
 *    SoA broadcast carries their Position/Tile field values.
 */

import { existsSync, mkdirSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { Elysia, file, type TSchema } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import {
  MAX_INPUTS_PER_TICK,
  MAX_PAINTS_PER_TICK,
  MESSAGE_TYPES,
  networkedComponents,
  PROTOCOL_VERSION,
  type InputCmd,
  type GameStateMessage,
  type PlayerState,
} from "burger-shared";
import {
  createObserverSerializer,
  createSnapshotSerializer,
  createSoASerializer,
} from "bitecs/serialization";
import type { World } from "./world";
import debugFactory from "debug";
import type { ServerWebSocket } from "elysia/ws/bun";
import type { TypeCheck } from "elysia/type-system";
import { validateInput } from "./input-validation";
import { validatePaint } from "./paint-validation";
import { applyPaint } from "./paint";
import { parseSessionCookie, getSession } from "./auth/sessions";
import { getUserById } from "./auth/users";
import { authRoutes } from "./auth/routes";
import type { AuthConfig } from "./auth/config";

const debug = debugFactory("burger:network.server");

export type PlayerConnection = {
  eid: number;
  inputQueue: InputCmd[];
  lastAckedSeq: number;
  lastReceivedSeq: number;
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  paintsThisTick: number;
};

type WS = ServerWebSocket<{
  id?: string | undefined;
  validator?: TypeCheck<TSchema> | undefined;
}>;

const playerConnections = new Map<WS, PlayerConnection>();
const observerSerializers = new Map<WS, () => ArrayBuffer>();

let snapshotSerializer: () => ArrayBuffer;
let soaSerializer: (eids: readonly number[]) => ArrayBuffer;

// Entities whose field data has changed since the last broadcast tick.
// Populated by applyPaint when it creates a new tile entity (because the
// observer stream only carries structural events, not field values — we
// have to follow up with a SoA payload so clients see the painted tile's
// real coords + tileId, not zeros).
const dirtyEids = new Set<number>();

const SNAPSHOT_BUFFER_SIZE = 64 * 1024; // 64KB
const OBSERVER_BUFFER_SIZE = 4 * 1024; // 4KB per connection
const GAME_STATE_BUFFER_SIZE = 8 * 1024; // 8KB
const snapshotBuffer = new ArrayBuffer(SNAPSHOT_BUFFER_SIZE);

const gameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE);
const taggedGameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE + 1);
const taggedObserverBuffer = new Uint8Array(OBSERVER_BUFFER_SIZE + 1);
const textEncoder = new TextEncoder();

const tagMessage = (type: number, data: ArrayBuffer): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

export const createServer = ({
  port,
  world,
  db,
  authConfig,
  onPlayerJoin,
  onPlayerLeave,
}: {
  port: number;
  world: World;
  db: Database;
  authConfig: AuthConfig;
  onPlayerJoin: (displayName: string) => number;
  onPlayerLeave: (eid: number) => void;
}) => {
  const { Networked } = world.components;

  snapshotSerializer = createSnapshotSerializer(
    world,
    networkedComponents,
    snapshotBuffer,
  );
  soaSerializer = createSoASerializer(networkedComponents);

  if (!existsSync("./public/assets")) {
    mkdirSync("./public/assets", { recursive: true });
  }

  const indexExists = existsSync("./public/index.html");

  const app = new Elysia()
    .use(
      staticPlugin({
        assets: "./public/assets",
        prefix: "/assets",
      }),
    )
    .use(authRoutes({ db, config: authConfig }))
    .get("/", ({ set }) => {
      if (indexExists) return file("./public/index.html");
      // Dev mode: SPA is served by vite on :5173 and proxies /auth, /api,
      // /ws back to this server. Anyone hitting :5000/ directly should be
      // redirected there.
      set.status = 302;
      set.headers["location"] =
        process.env.VITE_DEV_URL ?? "http://localhost:5173";
      return "";
    })
    .get("/api/atlas", () => world.typeIdToAtlasSrc)
    .get("/api/catalog", () =>
      db
        .query(
          "SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id",
        )
        .all(),
    )
    .ws("/ws", {
      open(ws) {
        const data = ws.data as { headers?: Record<string, string | undefined> };
        const cookieHeader = data.headers?.cookie ?? null;
        const sessionId = parseSessionCookie(cookieHeader);
        if (!sessionId) {
          ws.close(4001, "unauthenticated");
          return;
        }
        const session = getSession(db, sessionId);
        if (!session) {
          ws.close(4001, "unauthenticated");
          return;
        }
        const user = getUserById(db, session.userId);
        if (!user) {
          ws.close(4001, "unauthenticated");
          return;
        }

        const displayName = user.displayName ?? user.username;
        const eid = onPlayerJoin(displayName);

        console.log(`client connected: eid=${eid}, user=${user.username}`);

        playerConnections.set(ws.raw, {
          eid,
          inputQueue: [],
          lastAckedSeq: -1,
          lastReceivedSeq: -1,
          userId: user.id,
          username: user.username,
          displayName,
          isAdmin: user.isAdmin,
          paintsThisTick: 0,
        });

        observerSerializers.set(
          ws.raw,
          createObserverSerializer(world, Networked, networkedComponents, {
            buffer: new ArrayBuffer(OBSERVER_BUFFER_SIZE),
          }),
        );

        debug("sending eid & snapshot");
        ws.sendBinary(
          tagMessage(
            MESSAGE_TYPES.YOUR_EID,
            new Int32Array([
              PROTOCOL_VERSION,
              eid,
              world.bounds.x,
              world.bounds.y,
              world.bounds.w,
              world.bounds.h,
            ]).buffer,
          ),
        );
        ws.sendBinary(tagMessage(MESSAGE_TYPES.SNAPSHOT, snapshotSerializer()));
      },

      close(ws) {
        console.log("client disconnected");
        const connection = playerConnections.get(ws.raw);
        if (connection) {
          onPlayerLeave(connection.eid);
        }
        playerConnections.delete(ws.raw);
        observerSerializers.delete(ws.raw);
      },

      message(ws, message: any) {
        const connection = playerConnections.get(ws.raw);
        if (!connection) return;
        try {
          if (message?.type === "paint") {
            handlePaintMessage(world, db, connection, message);
          } else {
            handleInputMessage(connection, message);
          }
        } catch (e) {
          console.error("Failed to parse message:", e);
        }
      },
    })
    .listen(port);

  console.log(`Server running on ${app.server?.hostname}:${app.server?.port}`);
  return app;
};

const handleInputMessage = (
  connection: PlayerConnection,
  data: unknown,
): void => {
  const cmd = validateInput(data, connection.lastReceivedSeq);
  if (!cmd) return;
  connection.lastReceivedSeq = cmd.seq;
  connection.inputQueue.push(cmd);
  while (connection.inputQueue.length > 128) connection.inputQueue.shift();
};

const handlePaintMessage = (
  world: World,
  db: Database,
  connection: PlayerConnection,
  data: unknown,
): void => {
  if (!connection.isAdmin) return;
  if (connection.paintsThisTick >= MAX_PAINTS_PER_TICK) return;
  const cmd = validatePaint(data, world, world.catalogIds);
  if (!cmd) return;
  connection.paintsThisTick++;
  applyPaint(world, db, cmd, connection.userId);
};

export const getPlayerConnections = () => playerConnections;

/**
 * Mark an entity as having changed field data since the last broadcast. The
 * next broadcastGameState() will include this entity in the SoA payload so
 * clients can see its actual values (the bitecs OBSERVER stream only carries
 * structural add/remove events, not field values).
 */
export const markEntityDirty = (eid: number): void => {
  dirtyEids.add(eid);
};

export const resetPaintCounters = (): void => {
  for (const [, connection] of playerConnections) {
    connection.paintsThisTick = 0;
  }
};

export const processPlayerInputs = (
  applyInput: (eid: number, cmd: InputCmd) => void,
): void => {
  for (const [, connection] of playerConnections) {
    const { eid, inputQueue } = connection;
    const toProcess = inputQueue.splice(0, MAX_INPUTS_PER_TICK);
    for (const cmd of toProcess) {
      applyInput(eid, cmd);
      connection.lastAckedSeq = cmd.seq;
    }
  }
};

export const broadcastGameState = ({
  playerStates,
}: {
  playerStates: PlayerState[];
}): void => {
  if (playerConnections.size === 0) return;

  const gameState: GameStateMessage = { players: playerStates };
  const jsonString = JSON.stringify(gameState);
  const { written: gameStateLength } = textEncoder.encodeInto(
    jsonString,
    gameStateBuffer,
  );

  taggedGameStateBuffer[0] = MESSAGE_TYPES.GAME_STATE;
  taggedGameStateBuffer.set(gameStateBuffer.subarray(0, gameStateLength), 1);
  const taggedStateView = taggedGameStateBuffer.subarray(
    0,
    gameStateLength + 1,
  );

  // SoA payload covering entities whose field data changed since the last
  // broadcast. Serialized once and broadcast to every client. Sent AFTER the
  // observer payload so the client has already added the entity locally.
  let soaPayload: ArrayBuffer | null = null;
  if (dirtyEids.size > 0) {
    const eids = Array.from(dirtyEids);
    dirtyEids.clear();
    const buf = soaSerializer(eids);
    if (buf.byteLength > 0) {
      soaPayload = tagMessage(MESSAGE_TYPES.SOA, buf);
      debug(
        "soa broadcast: %d entities, %d bytes",
        eids.length,
        buf.byteLength,
      );
    }
  }

  for (const [ws] of playerConnections) {
    ws.sendBinary(taggedStateView);

    const observerSerializer = observerSerializers.get(ws);
    if (observerSerializer) {
      const updates = observerSerializer();
      if (updates.byteLength > 0) {
        taggedObserverBuffer[0] = MESSAGE_TYPES.OBSERVER;
        taggedObserverBuffer.set(new Uint8Array(updates), 1);
        ws.sendBinary(taggedObserverBuffer.subarray(0, updates.byteLength + 1));
      }
    }

    if (soaPayload) {
      ws.sendBinary(soaPayload);
    }
  }
};
