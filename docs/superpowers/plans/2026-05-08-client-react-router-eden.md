# Client → React Router v7 + Eden + Zustand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert burger-client from imperative-DOM-bootstrap to a React Router v7 data-mode SPA with Eden Treaty for typed RPC and Zustand bridging the imperative game to React-rendered chrome. The bitecs/Pixi/WebSocket internals are unchanged in behavior.

**Architecture:** The Elysia server's chain is lifted into `app.ts` so its type can be imported into the client. The client mounts `<RouterProvider>` with three routes — `/` (game), `/login`, `/atlas` (placeholder). The game lives inside a single `<Game/>` component that mounts a Pixi canvas via one `useEffect` and calls `startGame(parent, user)`. Zustand carries auth user, editor state, and metrics between the game's imperative loop and React components. Eden Treaty calls live in route loaders.

**Tech Stack:** React 19, React Router v7 (data mode, no Vite plugin), `@elysiajs/eden` (Treaty), Zustand 5, `@vitejs/plugin-react`, existing Pixi 8 + bitecs 0.4 + Elysia 1.4.

**Spec:** `docs/superpowers/specs/2026-05-08-client-react-router-eden-design.md`
**Branch:** `client-react-router-eden` (already checked out)

---

## File structure (final state)

| Path                                           | Responsibility                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/burger-server/src/app.ts`            | NEW. `buildApp(deps)` returns the typed Elysia app. `App` type.                                                                                              |
| `packages/burger-server/src/index.ts`          | NEW. Re-exports `App` type for client consumption.                                                                                                           |
| `packages/burger-server/src/network.server.ts` | `createServer` becomes thin listen-wrapper around `buildApp`. Helper exports unchanged.                                                                      |
| `packages/burger-server/package.json`          | Add `main`/`types`/`exports` fields.                                                                                                                         |
| `packages/burger-client/src/main.tsx`          | NEW. React entrypoint, mounts `<RouterProvider>`.                                                                                                            |
| `packages/burger-client/src/router.ts`         | NEW. Route tree + loaders.                                                                                                                                   |
| `packages/burger-client/src/eden.ts`           | NEW. Typed Eden Treaty client.                                                                                                                               |
| `packages/burger-client/src/store.ts`          | NEW. Zustand store.                                                                                                                                          |
| `packages/burger-client/src/types.ts`          | NEW. `Me` and shared client types (extracted from auth.client.ts).                                                                                           |
| `packages/burger-client/src/routes/Game.tsx`   | NEW. Game route component.                                                                                                                                   |
| `packages/burger-client/src/routes/Login.tsx`  | NEW. Sign-in screen as JSX.                                                                                                                                  |
| `packages/burger-client/src/routes/Atlas.tsx`  | NEW. Placeholder for phase 2.                                                                                                                                |
| `packages/burger-client/src/game/index.ts`     | RENAMED from `src/client.ts`. Exports `startGame()`.                                                                                                         |
| `packages/burger-client/src/game/network.ts`   | RENAMED from `src/network.client.ts`.                                                                                                                        |
| `packages/burger-client/src/game/editor.ts`    | RENAMED from `src/editor.client.ts`.                                                                                                                         |
| `packages/burger-client/src/game/consts.ts`    | RENAMED from `src/consts.client.ts`.                                                                                                                         |
| `packages/burger-client/src/auth.client.ts`    | DELETED.                                                                                                                                                     |
| `packages/burger-client/src/style.css`         | Add styles for `.login-screen`, `.atlas-placeholder`, `.game-root`.                                                                                          |
| `packages/burger-client/index.html`            | Add `<div id="root">`, point to `main.tsx`.                                                                                                                  |
| `packages/burger-client/vite.config.ts`        | Add `@vitejs/plugin-react`.                                                                                                                                  |
| `packages/burger-client/tsconfig.json`         | Add `"jsx": "react-jsx"`.                                                                                                                                    |
| `packages/burger-client/package.json`          | Add deps: react, react-dom, react-router, @elysiajs/eden, zustand, burger-server (workspace). devDeps: @vitejs/plugin-react, @types/react, @types/react-dom. |

---

## Task 1: Lift server Elysia chain into app.ts

**Files:**

- Create: `packages/burger-server/src/app.ts`
- Create: `packages/burger-server/src/index.ts`
- Modify: `packages/burger-server/src/network.server.ts`
- Modify: `packages/burger-server/package.json`

This task extracts the Elysia route construction from `createServer()` so the resulting app's type is exportable. `createServer` becomes a thin wrapper: build the app, call `.listen(port)`, return.

- [ ] **Step 1: Read current `network.server.ts` to identify what stays**

The exports `getPlayerConnections`, `markEntityDirty`, `resetPaintCounters`, `processPlayerInputs`, `broadcastGameState`, `tagMessage`, `validateInput`, `validatePaint`, `applyPaint`, `setRadioSignalHandler`, etc. are all helpers used by the active tick loop. They stay in `network.server.ts`. Only the `new Elysia()...` chain inside `createServer` moves.

The module-level state stays in `network.server.ts`:

- `playerConnections: Map<WS, PlayerConnection>`
- `observerSerializers: Map<WS, () => ArrayBuffer>`
- `snapshotSerializer`, `soaSerializer` (let bindings)
- `dirtyEids: Set<number>`
- All the buffer constants

The `Elysia` chain (lines 156-269 in current file) moves to `app.ts`. The `createServer` function reduces to: assign `snapshotSerializer` and `soaSerializer`, ensure public dir exists, call `buildApp(deps)`, call `.listen(port)`.

- [ ] **Step 2: Write `packages/burger-server/src/app.ts`**

```ts
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
  getSoaPayloadForDirty,
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

  return new Elysia()
    .use(
      staticPlugin({
        assets: "./public/assets",
        prefix: "/assets",
      }),
    )
    .use(authRoutes({ db, config: authConfig }))
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
        ws.sendBinary(tagMessage(MESSAGE_TYPES.SNAPSHOT, getSnapshotPayload()));
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
    });
};

export type App = ReturnType<typeof buildApp>;
```

This introduces some new helper exports from `network.server.ts` (`registerConnection`, `unregisterConnection`, `getObserverSerializers`, `getSnapshotPayload`, `handleIncomingMessage`, `OBSERVER_BUFFER_SIZE`) so we don't need to expose all the module-level state. They wrap existing logic. Step 3 implements them.

- [ ] **Step 3: Refactor `network.server.ts`**

The full updated file. Replace contents with:

```ts
/**
 * Authoritative server model — see app.ts for the route construction.
 *
 * This module owns the per-tick simulation state and serializers:
 * - playerConnections, observerSerializers, dirtyEids
 * - snapshotSerializer / soaSerializer (lazily initialised by createServer)
 * - per-tick helpers: processPlayerInputs, broadcastGameState
 * - per-paint helpers: markEntityDirty, applyPaint dispatch
 *
 * The Elysia route chain is built by app.ts and consumes the helpers
 * exported here.
 */

import { existsSync, mkdirSync } from "node:fs";
import type { Database } from "bun:sqlite";
import {
  MAX_INPUTS_PER_TICK,
  MAX_PAINTS_PER_TICK,
  MESSAGE_TYPES,
  networkedComponents,
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
import type { TSchema } from "elysia";
import type { TypeCheck } from "elysia/type-system";
import { validateInput } from "./input-validation";
import { validatePaint } from "./paint-validation";
import { applyPaint } from "./paint";
import { buildApp, type AppDeps } from "./app";

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

const dirtyEids = new Set<number>();

const SNAPSHOT_BUFFER_SIZE = 64 * 1024;
export const OBSERVER_BUFFER_SIZE = 4 * 1024;
const GAME_STATE_BUFFER_SIZE = 8 * 1024;
const snapshotBuffer = new ArrayBuffer(SNAPSHOT_BUFFER_SIZE);

const gameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE);
const taggedGameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE + 1);
const taggedObserverBuffer = new Uint8Array(OBSERVER_BUFFER_SIZE + 1);
const textEncoder = new TextEncoder();

export const tagMessage = (type: number, data: ArrayBuffer): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

export const createServer = (
  deps: AppDeps & { port: number },
): ReturnType<ReturnType<typeof buildApp>["listen"]> => {
  snapshotSerializer = createSnapshotSerializer(
    deps.world,
    networkedComponents,
    snapshotBuffer,
  );
  soaSerializer = createSoASerializer(networkedComponents);

  if (!existsSync("./public/assets")) {
    mkdirSync("./public/assets", { recursive: true });
  }

  const app = buildApp(deps).listen(deps.port);
  console.log(`Server running on ${app.server?.hostname}:${app.server?.port}`);
  return app;
};

export const registerConnection = (
  ws: WS,
  fields: Pick<
    PlayerConnection,
    "eid" | "userId" | "username" | "displayName" | "isAdmin"
  >,
): void => {
  playerConnections.set(ws, {
    ...fields,
    inputQueue: [],
    lastAckedSeq: -1,
    lastReceivedSeq: -1,
    paintsThisTick: 0,
  });
};

export const unregisterConnection = (ws: WS): void => {
  playerConnections.delete(ws);
  observerSerializers.delete(ws);
};

export const getObserverSerializers = () => observerSerializers;
export const getSnapshotPayload = () => snapshotSerializer();

export const handleIncomingMessage = (
  world: World,
  db: Database,
  ws: WS,
  message: unknown,
): void => {
  const connection = playerConnections.get(ws);
  if (!connection) return;
  try {
    const data = message as { type?: string };
    if (data?.type === "paint") {
      handlePaintMessage(world, db, connection, message);
    } else {
      handleInputMessage(connection, message);
    }
  } catch (e) {
    console.error("Failed to parse message:", e);
  }
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

export const getSoaPayloadForDirty = (): ArrayBuffer | null => {
  if (dirtyEids.size === 0) return null;
  const eids = Array.from(dirtyEids);
  dirtyEids.clear();
  const buf = soaSerializer(eids);
  if (buf.byteLength === 0) return null;
  debug("soa broadcast: %d entities, %d bytes", eids.length, buf.byteLength);
  return buf;
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

  const soa = getSoaPayloadForDirty();
  const soaPayload = soa ? tagMessage(MESSAGE_TYPES.SOA, soa) : null;

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
```

The diff vs current file:

- Top docstring slimmed (full protocol doc moves to spec/app.ts).
- The Elysia chain is gone — moved to `buildApp` in `app.ts`.
- New helpers: `registerConnection`, `unregisterConnection`, `getObserverSerializers`, `getSnapshotPayload`, `handleIncomingMessage`, `getSoaPayloadForDirty`. Each wraps state previously inlined in the chain.
- `OBSERVER_BUFFER_SIZE` is now exported (used by `app.ts`).
- `tagMessage` is now exported (used by `app.ts`).
- `createServer` becomes ~12 lines: init serializers, ensure dir, `buildApp(deps).listen(deps.port)`.

- [ ] **Step 4: Write `packages/burger-server/src/index.ts`**

```ts
export type { App } from "./app";
```

- [ ] **Step 5: Update `packages/burger-server/package.json`**

Add the `main`/`types`/`exports` fields so workspace consumers can resolve the type:

```json
{
  "name": "burger-server",
  "version": "0.1.0",
  "description": "hi, may i take your order?",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "module": "index.ts",
  "scripts": {
    "dev": "DEBUG=burger:* bun --env-file=../../.env --watch ./src/server.ts",
    "start": "bun ./src/server.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "^1.3.13",
    "@types/debug": "^4.1.13"
  },
  "peerDependencies": {
    "typescript": "^6"
  },
  "dependencies": {
    "@elysiajs/static": "^1.4.10",
    "bitecs": "^0.4.0",
    "burger-shared": "workspace:*",
    "debug": "^4.4.3",
    "elysia": "^1.4.28",
    "tiny-invariant": "^1.3.3"
  }
}
```

- [ ] **Step 6: Verify**

```bash
cd /Users/jack/repos/personal/burger
pnpm --filter burger-server exec tsc --noEmit
pnpm --filter burger-server test
timeout 4 pnpm dev:server || true
```

Expected: tsc clean. All 75 server tests pass. Server starts and prints "Server running on localhost:5000".

- [ ] **Step 7: Commit**

```bash
git add packages/burger-server/
git commit -m "chore: lift Elysia app construction to app.ts; export App type"
```

---

## Task 2: Add client deps for React + RR + Eden + Zustand

**Files:**

- Modify: `packages/burger-client/package.json`
- Modify: `packages/burger-client/tsconfig.json`

- [ ] **Step 1: Add deps**

```bash
cd /Users/jack/repos/personal/burger
pnpm --filter burger-client add react@^19.2.6 react-dom@^19.2.6 react-router@^7.15.0 @elysiajs/eden@^1.4.9 zustand@^5.0.13 burger-server@workspace:*
pnpm --filter burger-client add -D @vitejs/plugin-react@^6.0.1 @types/react@^19.2.14 @types/react-dom@^19.2.3
```

- [ ] **Step 2: Update `packages/burger-client/tsconfig.json`**

Replace the `compilerOptions` block to add `"jsx": "react-jsx"` and ensure the `lib` includes DOM:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "useDefineForClassFields": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

(The only changes are the new `"jsx": "react-jsx"` line. Other entries match the existing tsconfig.)

- [ ] **Step 3: Verify install + typecheck still passes (current code only)**

```bash
pnpm --filter burger-client exec tsc --noEmit
```

Expected: clean. The new deps are installed but no client code uses them yet.

- [ ] **Step 4: Commit**

```bash
git add packages/burger-client/package.json packages/burger-client/tsconfig.json pnpm-lock.yaml
git commit -m "chore: add react, react-router, eden, zustand client deps"
```

---

## Task 3: Wrap game in startGame() function (no behavior change)

This task refactors the existing `client.ts` from top-level imperative bootstrap into a `startGame(parent, user)` function that returns a cleanup. The function is renamed and moved to `src/game/index.ts` along with its sibling files. Behavior is unchanged.

**Files:**

- Create: `packages/burger-client/src/game/index.ts` (renamed from `client.ts`)
- Create: `packages/burger-client/src/game/network.ts` (renamed from `network.client.ts`)
- Create: `packages/burger-client/src/game/editor.ts` (renamed from `editor.client.ts`)
- Create: `packages/burger-client/src/game/consts.ts` (renamed from `consts.client.ts`)
- Create: `packages/burger-client/src/types.ts` (extracted from `auth.client.ts`)
- Delete: `packages/burger-client/src/auth.client.ts`
- Delete: `packages/burger-client/src/client.ts`
- Delete: `packages/burger-client/src/network.client.ts`
- Delete: `packages/burger-client/src/editor.client.ts`
- Delete: `packages/burger-client/src/consts.client.ts`

- [ ] **Step 1: Move files (preserving content)**

```bash
cd /Users/jack/repos/personal/burger/packages/burger-client/src
mkdir -p game
git mv client.ts game/index.ts
git mv network.client.ts game/network.ts
git mv editor.client.ts game/editor.ts
git mv consts.client.ts game/consts.ts
```

- [ ] **Step 2: Create `packages/burger-client/src/types.ts`**

Extract the `Me` type and any other client-shared types from `auth.client.ts`:

```ts
export type Me = {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
};
```

- [ ] **Step 3: Update import paths inside `game/`**

The moved files import each other via the old `./consts.client`, `./network.client`, `./editor.client` paths. Update each to use the new co-located names:

In `game/index.ts`:

- `./consts.client` → `./consts`
- `./network.client` → `./network`
- `./editor.client` → `./editor`
- `./auth.client` → `../types` for the `Me` type; the imperative sign-in screen helpers (`fetchMe`, `signIn`, `signOut`, `renderSignInScreen`) are removed entirely from this file (the React routes will own that flow).

In `game/network.ts`:

- `./client` → `.` (it imports the `World` type from the renamed entry; if it was importing `./client` for World, change to `./` or extract World type to a separate file. The cleanest fix: the World type currently lives in `client.ts` — extract it to a new `game/world.ts` if needed. **Step 5 handles this.**)

In `game/editor.ts`:

- `./network.client` → `./network`

- [ ] **Step 4: Refactor `game/index.ts` to export `startGame(parent, user)`**

The current top-level structure:

```ts
const world = createWorld({...});
export type World = typeof world;
// ... systems ...
const setup = async () => {
  const context = await setupRenderer();
  setupSocket({...});
};
setup();
```

Refactor to a single function. The full new shape:

```ts
import "../style.css";
// ... existing imports (sharedComponents, applyInputToVelocity, etc.)
// ...
import type { Me } from "../types";

// World creation moves INSIDE startGame so each invocation gets a fresh world.
// Export the type via a typeof factory call instead.

const makeWorld = () =>
  createWorld({
    components: {
      ...sharedComponents,
      Input: [] as {
        up: boolean;
        down: boolean;
        left: boolean;
        right: boolean;
        interact: boolean;
        interactPressed: boolean;
      }[],
      Sprite: [] as (PixiSprite | null)[],
      DebugText: [] as (PixiText | null)[],
      RenderPosition: { x: [] as number[], y: [] as number[] },
      PositionHistory: [] as PositionSnapshot[][],
    },
    time: { delta: 0, elapsed: 0, then: performance.now() },
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    typeIdToAtlasSrc: {} as Record<number, [number, number]>,
  });

export type World = ReturnType<typeof makeWorld>;

// ... existing system definitions (timeSystem, inputSystem, etc.) — they
// take a Context as before. Keep them at module scope.

// existing Context type — but `me` field renamed, see below.

const showDebug = true;

/**
 * Boot the game. Returns a cleanup function that fully tears down Pixi,
 * the WebSocket, the ticker, and any global event listeners.
 */
export const startGame = (parent: HTMLElement, user: Me): (() => void) => {
  const world = makeWorld();

  const app = new Application();
  let isRunning = true;
  const teardownCallbacks: Array<() => void> = [];

  // initial async setup
  void (async () => {
    await app.init({
      background: "#87CEEB",
      resizeTo: window,
      roundPixels: true,
      antialias: false,
    });

    if (!isRunning) {
      // unmounted before init completed
      app.destroy(true);
      return;
    }

    parent.appendChild(app.canvas);
    teardownCallbacks.push(() => {
      if (app.canvas.parentElement === parent) {
        parent.removeChild(app.canvas);
      }
    });

    const assets = await loadAssets();
    const mainContainer = new Container();
    const tilesContainer = new Container();
    const entitiesContainer = new Container();
    const debugContainer = new Container();

    app.stage.addChild(mainContainer);
    mainContainer.addChild(tilesContainer);
    mainContainer.addChild(entitiesContainer);
    mainContainer.addChild(debugContainer);

    const context: Context = {
      world,
      app,
      containers: {
        main: mainContainer,
        tiles: tilesContainer,
        entities: entitiesContainer,
        debug: debugContainer,
      },
      assets,
      input: { keys: {}, prevInteract: false },
      me: { eid: null, serverEid: null },
      network: {
        socket: null,
        inputSeq: 0,
        lastSentSeq: -1,
        pendingInputs: [],
        predictionError: { x: 0, y: 0 },
        idMap: new Map(),
        bytesSent: 0,
        bytesReceived: 0,
        lagMs: 0,
        jitterMs: 0,
      },
      camera: { x: 0, y: 0, initialized: false },
      metrics: {
        updatesHz: 0,
        updatesCount: 0,
        lastUpdateTime: 0,
        lastBytesSent: 0,
        lastBytesReceived: 0,
        bytesSentPerSec: 0,
        bytesReceivedPerSec: 0,
        serverTicksCount: 0,
        lastServerTickTime: 0,
        serverTickrate: 0,
      },
      debugMetrics: {
        updatesHz: 0,
        tickrate: 0,
        bytesSentPerSec: 0,
        bytesReceivedPerSec: 0,
        lag: 0,
        jitter: 0,
      },
      user,
      editor: null,
    };

    setupPlayerObserver(context);
    setupTileObserver(context);

    if (showDebug) {
      const gui = new GUI();
      gui.add(context.debugMetrics, "updatesHz").name("Updates/sec").listen();
      gui
        .add(context.debugMetrics, "tickrate")
        .name("Server Tickrate (Hz)")
        .listen();
      gui
        .add(context.debugMetrics, "bytesSentPerSec")
        .name("Bytes Sent/sec")
        .listen();
      gui
        .add(context.debugMetrics, "bytesReceivedPerSec")
        .name("Bytes Received/sec")
        .listen();
      gui.add(context.debugMetrics, "lag", 0, 1000).name("Lag (ms)").listen();
      gui
        .add(context.debugMetrics, "jitter", 0, 500)
        .name("Jitter (ms)")
        .listen();
      const accountFolder = gui.addFolder("Account");
      const accountInfo = { name: user.displayName ?? user.username };
      accountFolder.add(accountInfo, "name").name("Signed in as").disable();
      accountFolder
        .add(
          {
            signOut: async () => {
              await fetch("/auth/logout", { method: "POST" });
              window.location.href = "/login";
            },
          },
          "signOut",
        )
        .name("Sign out");
      gui.domElement.style.position = "absolute";
      gui.domElement.style.top = "10px";
      gui.domElement.style.right = "10px";
      context.gui = gui;
      teardownCallbacks.push(() => gui.destroy());
    }

    const onKeyDown = (e: KeyboardEvent) => {
      context.input.keys[e.key.toLowerCase()] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      context.input.keys[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    teardownCallbacks.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });

    const tickFn = () => update(context);
    app.ticker.add(tickFn);
    teardownCallbacks.push(() => app.ticker.remove(tickFn));

    setupSocket({
      world,
      network: context.network,
      me: context.me,
      onLocalPlayerReady: async () => {
        if (context.me.eid !== null) {
          const { Input } = world.components;
          addComponent(world, context.me.eid, Input);
          Input[context.me.eid] = {
            up: false,
            down: false,
            left: false,
            right: false,
            interact: false,
            interactPressed: false,
          };
          if (context.user.isAdmin) {
            context.editor = initEditor(
              context.app,
              context.assets.catalog,
              context.assets.tiles,
              context.network,
              context.containers.main,
              () => context.camera,
              () => ZOOM,
            );
          }
        }
      },
      onSnapshotReceived: () => {
        debug("snapshot received");
      },
      onSocketClose: () => debug("socket closed"),
      context,
    });
    teardownCallbacks.push(() => {
      if (context.network.socket) {
        context.network.socket.close();
      }
    });

    // expose for debugging
    (window as any).context = context;
  })();

  return () => {
    isRunning = false;
    while (teardownCallbacks.length > 0) {
      const fn = teardownCallbacks.pop();
      try {
        fn?.();
      } catch (e) {
        console.error("teardown failed", e);
      }
    }
    try {
      app.destroy(true);
    } catch {
      // already destroyed
    }
  };
};
```

Key changes from the previous structure:

1. Top-level `setup()` and the call `setup()` are gone.
2. World creation, app init, container setup, observer setup, ticker, socket — all happen inside `startGame`.
3. `Context.user: Me` (was `user: Me`) is now passed in via parameter.
4. The function returns a cleanup that tears down listeners, ticker, GUI, socket, and Pixi app.
5. The async init is wrapped in an IIFE so the cleanup synchronously sees `isRunning = false` if the component unmounts before init completes.
6. The sign-out flow is inline in the GUI accountFolder; it `fetch("/auth/logout")` then navigates to `/login`. (Auth helpers from the old `auth.client.ts` are gone — `signOut` is inlined here for now; future cleanup could centralize it.)

(Existing `setupPlayerObserver`, `setupTileObserver`, `update`, `loadAssets`, `tileSpriteSystem`, etc. live at module scope unchanged. Just add a `user: Me` field to the `Context` type and `editor: EditorState | null`.)

Edit `Context` type to include `user: Me`:

```ts
type Context = {
  world: World;
  app: Application;
  containers: {
    main: Container;
    tiles: Container;
    entities: Container;
    debug: Container;
  };
  assets: Awaited<ReturnType<typeof loadAssets>>;
  input: { keys: Record<string, boolean>; prevInteract: boolean };
  me: PlayerIdentity;
  network: NetworkState;
  camera: { x: number; y: number; initialized: boolean };
  metrics: {
    /* unchanged */
  };
  debugMetrics: {
    /* unchanged */
  };
  gui?: GUI;
  user: Me;
  editor: EditorState | null;
};
```

- [ ] **Step 5: Extract `World` type if `network.ts` needs it**

If `network.ts` does `import type { World } from "./client"` (via the old name), it now needs to import from `./` (game/index.ts). With the rename above, the `World` export is at `./` from network.ts's perspective, so:

In `game/network.ts`:

```ts
import type { World } from "./";
```

Or if Vite/TS doesn't like the `./` style, use `./index`:

```ts
import type { World } from "./index";
```

- [ ] **Step 6: Delete `auth.client.ts`**

```bash
rm packages/burger-client/src/auth.client.ts
```

The sign-in screen logic is reborn in Task 4's `<Login/>` component. The `Me` type is now in `types.ts`.

- [ ] **Step 7: Verify**

The full client app no longer has an entrypoint that runs (we deleted `client.ts` as the top-level file). `index.html` still references `/src/client.ts` which doesn't exist. To keep this task self-contained and verifiable, ALSO update `index.html` to point at a new (temporary) entry that just calls `startGame`:

Actually no — let's NOT make this build temporarily. Skip the build verification at this task's commit boundary; just verify typecheck:

```bash
pnpm --filter burger-client exec tsc --noEmit
```

Expected: clean. (The build step `pnpm --filter burger-client build` will fail because index.html points to a non-existent file. That's expected; Task 4 fixes it.)

Run server tests to confirm we didn't accidentally break burger-server:

```bash
pnpm --filter burger-server test
```

Expected: 75/75 pass.

- [ ] **Step 8: Commit**

```bash
git add packages/burger-client/
git commit -m "refactor(client): wrap game in startGame() function (no behavior change)"
```

---

## Task 4: React Router data mode shell

**Files:**

- Create: `packages/burger-client/src/main.tsx`
- Create: `packages/burger-client/src/router.ts`
- Create: `packages/burger-client/src/eden.ts`
- Create: `packages/burger-client/src/routes/Game.tsx`
- Create: `packages/burger-client/src/routes/Login.tsx`
- Create: `packages/burger-client/src/routes/Atlas.tsx`
- Modify: `packages/burger-client/index.html`
- Modify: `packages/burger-client/vite.config.ts`
- Modify: `packages/burger-client/src/style.css`

- [ ] **Step 1: Update `vite.config.ts` to use the React plugin**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:5000", changeOrigin: true },
      "/auth": { target: "http://localhost:5000", changeOrigin: true },
      "/ws": {
        target: "ws://localhost:5000/",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 2: Create `packages/burger-client/src/eden.ts`**

```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "burger-server";

export const eden = treaty<App>(window.location.origin);
```

If TS reports errors resolving `App` (e.g. Vite tries to evaluate burger-server's runtime modules), pre-empt with an explicit fallback path:

Look at the diagnostic. If the issue is that `burger-server`'s `index.ts` re-exports a type that pulls in `bun:sqlite`, the fix is to ensure `burger-server/src/index.ts` does **type-only** re-exports (`export type { App } ...`). The current Task 1 spec uses `export type {}` which is correct. Verify.

- [ ] **Step 3: Create `packages/burger-client/src/routes/Login.tsx`**

```tsx
import { useLoaderData } from "react-router";

type LoaderData = { error: string | null };

const Login = () => {
  const { error } = useLoaderData() as LoaderData;
  return (
    <div className="login-screen">
      <h1>burger</h1>
      {error && <p className="error">error: {error}</p>}
      <a href="/auth/4orm" className="button">
        sign in with 4orm
      </a>
    </div>
  );
};

export default Login;
```

- [ ] **Step 4: Create `packages/burger-client/src/routes/Atlas.tsx`**

```tsx
const Atlas = () => (
  <div className="atlas-placeholder">
    <h1>atlas</h1>
    <p>coming soon (phase 2)</p>
    <a href="/">back to game</a>
  </div>
);

export default Atlas;
```

- [ ] **Step 5: Create `packages/burger-client/src/routes/Game.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { useLoaderData } from "react-router";
import { startGame } from "../game";
import type { Me } from "../types";

type LoaderData = { user: Me };

const Game = () => {
  const { user } = useLoaderData() as LoaderData;
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = canvasRef.current;
    if (!parent) return;
    const stop = startGame(parent, user);
    return () => stop();
  }, [user]);

  return <div ref={canvasRef} className="game-root" />;
};

export default Game;
```

- [ ] **Step 6: Create `packages/burger-client/src/router.ts`**

```ts
import { createBrowserRouter, redirect } from "react-router";
import Game from "./routes/Game";
import Login from "./routes/Login";
import Atlas from "./routes/Atlas";
import { eden } from "./eden";
import type { Me } from "./types";

const fetchMe = async (): Promise<Me | null> => {
  const { data, error } = await eden.auth.me.get();
  if (error || !data) return null;
  return data as Me;
};

const gameLoader = async () => {
  const user = await fetchMe();
  if (!user) throw redirect("/login");
  return { user };
};

const loginLoader = async ({ request }: { request: Request }) => {
  const user = await fetchMe();
  if (user) throw redirect("/");
  const url = new URL(request.url);
  return { error: url.searchParams.get("error") };
};

const atlasLoader = async () => {
  const user = await fetchMe();
  if (!user) throw redirect("/login");
  if (!user.isAdmin) throw redirect("/");
  return { user };
};

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Game,
    loader: gameLoader,
    shouldRevalidate: () => false,
  },
  {
    path: "/login",
    Component: Login,
    loader: loginLoader,
  },
  {
    path: "/atlas",
    Component: Atlas,
    loader: atlasLoader,
  },
]);
```

`shouldRevalidate: () => false` on the game route prevents React Router from re-running the loader (and re-mounting the game) when navigating between routes and back.

- [ ] **Step 7: Create `packages/burger-client/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

- [ ] **Step 8: Update `packages/burger-client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>burger</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Add styles in `packages/burger-client/src/style.css`**

Append:

```css
body {
  margin: 0;
}

.game-root {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
}

.login-screen,
.atlas-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-family: monospace;
  gap: 1em;
}

.login-screen h1,
.atlas-placeholder h1 {
  margin: 0;
}

.login-screen .error {
  color: red;
}

.login-screen .button,
.atlas-placeholder a {
  padding: 0.5em 1em;
  font-size: 1em;
  cursor: pointer;
  background: #222;
  color: #fff;
  text-decoration: none;
  border-radius: 4px;
}
```

- [ ] **Step 10: Verify**

```bash
cd /Users/jack/repos/personal/burger
pnpm --filter burger-client exec tsc --noEmit
pnpm --filter burger-client build
```

Expected: typecheck clean, build succeeds.

Smoke test:

```bash
timeout 8 pnpm dev || true
```

Expected: server starts on `:5000`, vite starts on `:5173`. Hitting `localhost:5173/login` in a browser shows the sign-in screen. Hitting `/` redirects to `/login` (when unauthed). After sign-in, `/` shows the game.

If the Eden import fails the build with an error mentioning `bun:sqlite` or similar runtime modules, the issue is that `burger-server/src/index.ts` is pulling those in. The fix:

1. Ensure `burger-server/src/index.ts` is exactly:
   ```ts
   export type { App } from "./app";
   ```
   (with `export type`, not `export`).
2. Ensure `app.ts` itself only imports types from places like `bun:sqlite` (`import type { Database } from "bun:sqlite"`).

If the build still complains, fall back to the `dist/` strategy: add a `build:types` script in burger-server (`tsc --emitDeclarationOnly --outDir dist`), run it before client builds, and point burger-server's `types` field at `./dist/index.d.ts` instead of source.

- [ ] **Step 11: Commit**

```bash
git add packages/burger-client/
git commit -m "feat(client): React Router data mode shell (/, /login, /atlas)"
```

---

## Task 5: Zustand store; route metrics + user through it

**Files:**

- Create: `packages/burger-client/src/store.ts`
- Modify: `packages/burger-client/src/game/index.ts`
- Modify: `packages/burger-client/src/routes/Game.tsx`

This task introduces the Zustand store and wires the imperative game's metrics + editor state through it. lil-gui keeps its own state for now; this task just adds the store as the React-side source of truth.

- [ ] **Step 1: Create `packages/burger-client/src/store.ts`**

```ts
import { create } from "zustand";
import type { Me } from "./types";

export type DebugMetrics = {
  tickrate: number;
  lag: number;
  updatesHz: number;
  bytesSentPerSec: number;
  bytesReceivedPerSec: number;
};

export type EditorPublicState = {
  active: boolean;
  selectedTileId: number;
};

type GameStore = {
  user: Me | null;
  editor: EditorPublicState | null;
  metrics: DebugMetrics;

  setUser: (u: Me | null) => void;
  setEditor: (e: EditorPublicState | null) => void;
  setEditorActive: (active: boolean) => void;
  setSelectedTileId: (id: number) => void;
  setMetrics: (m: Partial<DebugMetrics>) => void;
};

export const useGameStore = create<GameStore>((set) => ({
  user: null,
  editor: null,
  metrics: {
    tickrate: 0,
    lag: 0,
    updatesHz: 0,
    bytesSentPerSec: 0,
    bytesReceivedPerSec: 0,
  },

  setUser: (user) => set({ user }),
  setEditor: (editor) => set({ editor }),
  setEditorActive: (active) =>
    set((s) => (s.editor ? { editor: { ...s.editor, active } } : s)),
  setSelectedTileId: (selectedTileId) =>
    set((s) => (s.editor ? { editor: { ...s.editor, selectedTileId } } : s)),
  setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),
}));
```

- [ ] **Step 2: Wire metrics into `game/index.ts`**

Find the existing `metricsSystem` function and add a Zustand call:

```ts
const metricsSystem = ({ network, metrics, debugMetrics }: Context) => {
  const now = performance.now();

  if (now - metrics.lastUpdateTime >= 1000) {
    const deltaTime = (now - metrics.lastUpdateTime) / 1000;
    metrics.updatesHz = metrics.updatesCount;
    metrics.updatesCount = 0;
    metrics.bytesSentPerSec =
      (network.bytesSent - metrics.lastBytesSent) / deltaTime;
    metrics.lastBytesSent = network.bytesSent;
    metrics.bytesReceivedPerSec =
      (network.bytesReceived - metrics.lastBytesReceived) / deltaTime;
    metrics.lastBytesReceived = network.bytesReceived;
    metrics.lastUpdateTime = now;
  }

  if (now - metrics.lastServerTickTime >= 1000) {
    metrics.serverTickrate = metrics.serverTicksCount;
    metrics.serverTicksCount = 0;
    metrics.lastServerTickTime = now;
  }

  debugMetrics.updatesHz = metrics.updatesHz;
  debugMetrics.tickrate = metrics.serverTickrate;
  debugMetrics.bytesSentPerSec = Math.round(metrics.bytesSentPerSec);
  debugMetrics.bytesReceivedPerSec = Math.round(metrics.bytesReceivedPerSec);
  network.lagMs = debugMetrics.lag;
  network.jitterMs = debugMetrics.jitter;

  // Mirror to the React store so the chrome can render these.
  useGameStore.getState().setMetrics({
    tickrate: debugMetrics.tickrate,
    lag: debugMetrics.lag,
    updatesHz: debugMetrics.updatesHz,
    bytesSentPerSec: debugMetrics.bytesSentPerSec,
    bytesReceivedPerSec: debugMetrics.bytesReceivedPerSec,
  });
};
```

Add the import at the top of `game/index.ts`:

```ts
import { useGameStore } from "../store";
```

- [ ] **Step 3: Wire user + editor into the store on game start**

Inside `startGame`, after the editor is initialized in `onLocalPlayerReady`:

```ts
if (context.user.isAdmin) {
  context.editor = initEditor(...);
  useGameStore.getState().setEditor({
    active: false,
    selectedTileId: context.editor.selectedTileId,
  });
}
```

And at the very top of `startGame`, before any async work:

```ts
useGameStore.getState().setUser(user);
```

Also clear on cleanup:

```ts
teardownCallbacks.push(() => {
  useGameStore.getState().setUser(null);
  useGameStore.getState().setEditor(null);
});
```

- [ ] **Step 4: The editor's runtime state is the source of truth**

The existing editor (`game/editor.ts`) keeps its own `EditorState` (active, selectedTileId, etc.) — that's still the source of truth for the canvas overlay. The Zustand store mirrors only the bits React might want to display in chrome later. For now nothing reads from `useGameStore(s => s.editor)` outside of the store itself; that's fine.

Editor toggle keystroke (`e`/`Tab`) in `editor.ts` should also update the Zustand mirror. Find the keydown handler in `initEditor` and add:

```ts
window.addEventListener("keydown", (e) => {
  if (e.key === "e" || e.key === "Tab") {
    e.preventDefault();
    state.active = !state.active;
    palette.visible = state.active;
    if (!state.active && state.cursorSprite && state.cursorOutline) {
      state.cursorSprite.visible = false;
      state.cursorOutline.visible = false;
    }
    useGameStore.getState().setEditorActive(state.active);
    return;
  }
  // ...rest unchanged
});
```

And `selectTile`:

```ts
const selectTile = (state: EditorState, tileId: number): void => {
  state.selectedTileId = tileId;
  state.paletteSlots.forEach((slot, i) => {
    slot.outline.visible = state.catalog[i]?.id === tileId;
  });
  useGameStore.getState().setSelectedTileId(tileId);
};
```

Add the import to `editor.ts`:

```ts
import { useGameStore } from "../store";
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter burger-client exec tsc --noEmit
pnpm --filter burger-client build
```

Expected: clean.

Smoke:

```bash
timeout 8 pnpm dev || true
```

Sign in, play, toggle edit mode. Open browser DevTools console, run:

```js
window.__zustand_get?.(); // not exposed yet; the React tree owns it
```

To verify the store: ad-hoc check that the GUI's metrics still update (visual). The store wiring is mostly invisible until a future React component reads it.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-client/
git commit -m "feat(client): zustand store; route metrics + user through it"
```

---

## Task 6: Final verification

**Files:** none modified (verification only)

- [ ] **Step 1: Full check**

```bash
cd /Users/jack/repos/personal/burger
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm test
pnpm build-frontend
```

Expected:

- typecheck: 0 errors across all 3 packages
- lint: ≤ 2 warnings (the pre-existing `any` ones), 0 errors
- fmt:check: clean
- test: 75 server + 13 shared tests pass
- build-frontend: succeeds

If `fmt:check` reports new issues, run `pnpm fmt` and amend the most recent commit.

- [ ] **Step 2: Smoke `pnpm dev`**

```bash
timeout 10 pnpm dev || true
```

Expected: both server and client start, no errors in either log.

- [ ] **Step 3: Manual smoke (live, with mug deployed)**

For local dev with the local DB:

1. Open `http://localhost:5173/` in a fresh incognito window. Should redirect to `/login`.
2. Click "sign in with 4orm". Complete the OAuth flow. Land back at `/` with the game running.
3. Verify game functions: walk around, observe tiles, watch debug GUI metrics tick.
4. As an admin, press `e`. Edit mode activates. Paint a tile. Tile appears.
5. Visit `/atlas`. See the placeholder.
6. As an admin, sign out via the GUI. Redirected to `/login`.
7. Hit a non-admin user (set is_admin=0 in the DB temporarily): visit `/atlas`. Should redirect to `/`.

If everything passes, the phase 1 conversion is done. Phase 2 (the actual atlas tool) builds on this foundation.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin client-react-router-eden
gh pr create --title "Convert client to React Router v7 + Eden + Zustand (phase 1 of atlas tool)" --body "$(cat <<'EOF'
## Summary

Phase 1 of the atlas tool feature. Converts the burger-client SPA from imperative-DOM-bootstrap to React Router v7 in data mode, with Elysia Eden Treaty for typed RPC and Zustand bridging the imperative game to React-rendered chrome.

The bitecs/Pixi/WebSocket internals are unchanged in behavior. Phase 2 will build the actual atlas tool at \`/atlas\` on this foundation.

## Changes

- **Server:** Lifted Elysia route construction into \`packages/burger-server/src/app.ts\`. Exposed \`type App\` from a new \`packages/burger-server/src/index.ts\` for client consumption. \`createServer\` is now a thin listen-wrapper. New explicit \`/login\` and \`/atlas\` routes serve the SPA's index.html (or redirect to vite in dev).
- **Client:** New \`main.tsx\` mounts \`<RouterProvider>\` over three routes: \`/\` (game, gated on auth), \`/login\`, \`/atlas\` (admin-gated placeholder).
- **Game lifecycle:** \`<Game/>\` component owns the imperative game via one useEffect; \`startGame(parent, user)\` returns a cleanup. World creation, Pixi init, observers, ticker, socket all live inside \`startGame\`.
- **Eden Treaty:** Typed RPC client calls the server's \`/auth/*\` and \`/api/*\` endpoints. Loaders use it directly.
- **Zustand:** Bridges metrics, user, editor toggle from the imperative game to the React side.
- **WebSocket protocol:** Unchanged. Game data still flows through raw binary frames.

## Verification

- 75 server tests + 13 shared tests pass.
- \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm fmt:check\` clean.
- \`pnpm dev\` boots cleanly. Sign-in flow, gameplay, paint, palette, debug GUI all functional.

See \`docs/superpowers/specs/2026-05-08-client-react-router-eden-design.md\` for full design rationale.
EOF
)"
```

---

## Risk mitigations

1. **Eden type import.** If `import type { App } from "burger-server"` doesn't resolve cleanly under Vite, the most likely culprit is `burger-server/src/index.ts` accidentally pulling in runtime modules. Confirm the file is exactly `export type { App } from "./app";` — type-only re-exports are erased before bundling.
2. **StrictMode double-mount.** React 19's StrictMode in dev mounts effects twice. `startGame`'s `isRunning` flag and teardown sequence MUST handle being called once with cleanup before the async init resolves. The implementation in Task 3 Step 4 covers this.
3. **Loader revalidation.** RR may revalidate the game loader on navigation, causing the game to remount. The `shouldRevalidate: () => false` on the game route prevents this.
4. **Server tests broke by the refactor.** The `createServer` signature changes (it now takes the same shape but the return type is different — see Task 1 Step 3). Search test files for `createServer({` and confirm they still work. Likely affects `e2e.test.ts` and `paint-e2e.test.ts`.

   Specifically, the test files use `app = createServer({...})` then later call `app.stop(true)`. The new `createServer` returns the same Elysia listen result (`buildApp(deps).listen(deps.port)`), which has the same `.stop()` method. So the tests should keep working without modification. **Verify in Task 1 Step 6.**

---

## Final state

After all 6 tasks land:

- Burger client is a React Router data-mode SPA.
- Three routes; `/` serves the existing game, `/atlas` is a placeholder for phase 2.
- Eden Treaty is wired up and used by loaders.
- Zustand store exists and carries auth + metrics + editor state.
- The game's imperative core is encapsulated in `startGame(parent, user)` with a clean cleanup boundary.
- Server's `App` type is exposed; future endpoints will automatically gain client-side type safety through Eden.
- Phase 2 can build `/atlas` as a regular React route consuming Eden, no scaffolding needed.
