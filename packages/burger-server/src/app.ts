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
 *    The server runs the physics tick at (TICK_RATE)hz, but each input is
 *    applied at the client-supplied cmd.msec (clamped to MAX_INPUT_MSEC by
 *    the validator). This keeps motion-per-input frame-rate-independent:
 *    a 144Hz client sends ~144 short inputs/sec, a 60Hz client sends ~60
 *    longer inputs/sec, and both produce the same total motion per second.
 *    The clamp bounds speed-hacking to ~2x normal per input.
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

import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { Elysia, file } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  networkedComponents,
} from "burger-shared";
import { createObserverSerializer } from "bitecs/serialization";
import type { World } from "./world";
import type { AuthConfig } from "./auth/config";
import { authRoutes } from "./auth/routes";
import { parseSessionCookie, getSession } from "./auth/sessions";
import { getUserById } from "./auth/users";
import {
  OBSERVER_BUFFER_SIZE,
  getPlayerConnections,
  getObserverSerializers,
  getSnapshotPayload,
  registerConnection,
  unregisterConnection,
  handleIncomingMessage,
  tagMessage,
} from "./network.server";

export type AppDeps = {
  world: World;
  db: Database;
  authConfig: AuthConfig;
  onPlayerJoin: (displayName: string) => number;
  onPlayerLeave: (eid: number) => void;
};

export const buildApp = (deps: AppDeps) => {
  const { world, db, authConfig, onPlayerJoin, onPlayerLeave } = deps;
  const { Networked } = world.components;

  const indexExists = existsSync("./public/index.html");

  return (
    new Elysia()
      .use(
        staticPlugin({
          assets: "./public/assets",
          prefix: "/assets",
        }),
      )
      .use(authRoutes({ db, config: authConfig }))
      // SPA route fallbacks. In production, serves the bundled index.html for
      // every client-side route so React Router can take over. In dev, redirects
      // to the vite dev server which serves the SPA at :5173 (with /auth, /api,
      // /ws proxied back to this server).
      .get("/", ({ set }) => {
        if (indexExists) return file("./public/index.html");
        set.status = 302;
        set.headers["location"] =
          process.env.VITE_DEV_URL ?? "http://localhost:5173";
        return "";
      })
      .get("/login", ({ set }) => {
        if (indexExists) return file("./public/index.html");
        set.status = 302;
        set.headers["location"] =
          process.env.VITE_DEV_URL ?? "http://localhost:5173";
        return "";
      })
      .get("/atlas", ({ set }) => {
        if (indexExists) return file("./public/index.html");
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
          const data = ws.data as {
            headers?: Record<string, string | undefined>;
          };
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

          registerConnection(ws.raw, {
            eid,
            userId: user.id,
            username: user.username,
            displayName,
            isAdmin: user.isAdmin,
          });

          getObserverSerializers().set(
            ws.raw,
            createObserverSerializer(world, Networked, networkedComponents, {
              buffer: new ArrayBuffer(OBSERVER_BUFFER_SIZE),
            }),
          );

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
          ws.sendBinary(
            tagMessage(MESSAGE_TYPES.SNAPSHOT, getSnapshotPayload()),
          );
        },

        close(ws) {
          console.log("client disconnected");
          const connection = getPlayerConnections().get(ws.raw);
          if (connection) onPlayerLeave(connection.eid);
          unregisterConnection(ws.raw);
        },

        message(ws, message: any) {
          handleIncomingMessage(world, db, ws.raw, message);
        },
      })
  );
};

export type App = ReturnType<typeof buildApp>;
