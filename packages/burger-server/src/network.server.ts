/**
 * Authoritative server model, the server is the
 * single source of truth for all game state.
 *
 * 1. INPUT PROCESSING
 *    Clients send input commands
 *    The server queues these and processes them each tick.
 *    Each input has a sequence number for acknowledgment.
 *
 * 2. AUTHORITATIVE PHYSICS
 *    The server runs physics at (TICK_RATE)hz.
 *    All position/velocity updates happen here.
 *
 * 3. STATE BROADCAST
 *    Every tick, the server broadcasts GAME_STATE to all clients.
 *    This includes position, velocity, and last-acknowledged input seq.
 *    Clients use this to reconcile their predictions.
 *
 * 4. ENTITY SYNCHRONIZATION
 *    - SNAPSHOT: Full world state sent on connect
 *    - OBSERVER: Delta updates for entity add/remove
 *    - GAME_STATE: Authoritative positions
 */

import { existsSync, mkdirSync } from "node:fs";
import { Elysia, file, type TSchema } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import {
  MESSAGE_TYPES,
  networkedComponents,
  type InputCmd,
  type GameStateMessage,
  type PlayerState,
  type SignalMessage,
} from "burger-shared";
import {
  createObserverSerializer,
  createSnapshotSerializer,
} from "bitecs/serialization";
import type { World } from "./server";
import { ElysiaWS } from "elysia/ws";
import debugFactory from "debug";
import type { ServerWebSocket } from "elysia/ws/bun";
import type { TypeCheck } from "elysia/type-system";

const debug = debugFactory("burger:network.server");

export type PlayerConnection = {
  eid: number;
  inputQueue: InputCmd[];
  lastAckedSeq: number;
};

type WS = ServerWebSocket<{
  id?: string | undefined;
  validator?: TypeCheck<TSchema> | undefined;
}>;

const playerConnections = new Map<WS, PlayerConnection>();
const eidToWs = new Map<number, WS>(); // Reverse lookup for signaling
const observerSerializers = new Map<WS, () => ArrayBuffer>();

let snapshotSerializer: () => ArrayBuffer;

const SNAPSHOT_BUFFER_SIZE = 64 * 1024; // 64KB
const OBSERVER_BUFFER_SIZE = 4 * 1024; // 4KB per connection
const GAME_STATE_BUFFER_SIZE = 8 * 1024; // 8KB
const snapshotBuffer = new ArrayBuffer(SNAPSHOT_BUFFER_SIZE);

const gameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE);
const taggedGameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE + 1);
const taggedObserverBuffer = new Uint8Array(OBSERVER_BUFFER_SIZE + 1);
const textEncoder = new TextEncoder();

let radioSignalHandler: ((signal: SignalMessage) => void) | null = null;

export const setRadioSignalHandler = (
  handler: (signal: SignalMessage) => void
): void => {
  radioSignalHandler = handler;
};

const tagMessage = (type: number, data: ArrayBuffer): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

export const createServer = ({
  port,
  world,
  onPlayerJoin,
  onPlayerLeave,
}: {
  port: number;
  world: World;
  onPlayerJoin: () => number;
  onPlayerLeave: (eid: number) => void;
}) => {
  const { Networked } = world.components;

  snapshotSerializer = createSnapshotSerializer(
    world,
    networkedComponents,
    snapshotBuffer
  );

  if (!existsSync("./public/assets")) {
    mkdirSync("./public/assets", { recursive: true });
  }

  const app = new Elysia()
    .use(
      staticPlugin({
        assets: "./public/assets",
        prefix: "/assets",
      })
    )
    .get("/", () => file("./public/index.html"))
    .get("/api/atlas", () => world.typeIdToAtlasSrc)
    .ws("/ws", {
      open(ws) {
        const eid = onPlayerJoin();

        console.log(`client connected: eid=${eid}`);

        playerConnections.set(ws.raw, {
          eid,
          inputQueue: [],
          lastAckedSeq: -1,
        });
        eidToWs.set(eid, ws.raw);

        observerSerializers.set(
          ws.raw,
          createObserverSerializer(world, Networked, networkedComponents, {
            buffer: new ArrayBuffer(OBSERVER_BUFFER_SIZE),
          })
        );

        debug("sending eid & snapshot");
        ws.sendBinary(
          tagMessage(MESSAGE_TYPES.YOUR_EID, new Int32Array([eid]).buffer)
        );
        ws.sendBinary(tagMessage(MESSAGE_TYPES.SNAPSHOT, snapshotSerializer()));
      },

      close(ws) {
        console.log("client disconnected");
        const connection = playerConnections.get(ws.raw);
        if (connection) {
          eidToWs.delete(connection.eid);
          onPlayerLeave(connection.eid);
        }
        playerConnections.delete(ws.raw);
        observerSerializers.delete(ws.raw);
      },

      message(ws, message: any) {
        const connection = playerConnections.get(ws.raw);
        if (!connection) {
          return;
        }

        try {
          if (message.type === "signal") {
            handleSignalMessage(connection.eid, message);
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

const handleInputMessage = (connection: PlayerConnection, data: any): void => {
  const cmd: InputCmd = {
    seq: data.seq,
    msec: data.msec,
    up: data.up,
    down: data.down,
    left: data.left,
    right: data.right,
    interact: data.interact,
  };

  connection.inputQueue.push(cmd);

  if (connection.inputQueue.length > 128) {
    connection.inputQueue.shift();
  }
};

const handleSignalMessage = (fromEid: number, data: any): void => {
  const targetId = data.to as number;

  const signalMsg: SignalMessage = {
    from: fromEid,
    to: targetId,
    signal: data.signal,
  };

  if (targetId < 0) {
    if (!radioSignalHandler) {
      debug("radio signal handler not set");
      return;
    }
    radioSignalHandler(signalMsg);
    debug("forwarded signal from %s to radio %s", fromEid, targetId);
  } else {
    const targetWs = eidToWs.get(targetId);
    if (!targetWs) {
      debug("signal target not found: %s", targetId);
      return;
    }

    const encoder = new TextEncoder();
    const payload = encoder.encode(JSON.stringify(signalMsg)).buffer;
    targetWs.sendBinary(tagMessage(MESSAGE_TYPES.SIGNAL, payload));

    debug("relayed signal from %s to %s", fromEid, targetId);
  }
};

export const sendSignalToPlayer = (
  targetEid: number,
  signal: SignalMessage
): void => {
  const targetWs = eidToWs.get(targetEid);

  if (!targetWs) {
    debug("signal target not found: %s", targetEid);
    return;
  }

  const encoder = new TextEncoder();
  const payload = encoder.encode(JSON.stringify(signal)).buffer;
  targetWs.sendBinary(tagMessage(MESSAGE_TYPES.SIGNAL, payload));

  debug("sent signal to player %s", targetEid);
};

export const getPlayerConnections = () => playerConnections;

export const processPlayerInputs = (
  world: World,
  applyInput: (eid: number, cmd: InputCmd) => void
): void => {
  for (const [_ws, connection] of playerConnections) {
    const { eid, inputQueue } = connection;

    for (const cmd of inputQueue) {
      applyInput(eid, cmd);
      connection.lastAckedSeq = cmd.seq;
    }

    connection.inputQueue = [];
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
    gameStateBuffer
  );

  taggedGameStateBuffer[0] = MESSAGE_TYPES.GAME_STATE;
  taggedGameStateBuffer.set(gameStateBuffer.subarray(0, gameStateLength), 1);
  const taggedStateView = taggedGameStateBuffer.subarray(
    0,
    gameStateLength + 1
  );

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
  }
};
