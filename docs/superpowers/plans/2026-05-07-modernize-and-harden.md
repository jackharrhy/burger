# Modernize & Harden Implementation Plan

**Goal:** Drop voice/radio, bump deps, harden shared boundary and netcode, add tests.

**Spec:** `docs/superpowers/specs/2026-05-07-modernize-and-harden-design.md`

**Branch:** `modernize-and-drop-voice` (already checked out)

---

## Task 1: Remove voice & radio (deletion-only commit)

**Files:**
- Delete: `packages/burger-radio/` (entire dir)
- Delete: `packages/burger-client/src/voice.client.ts`
- Delete: `packages/burger-server/src/radio-manager.ts`
- Modify: `packages/burger-shared/src/types.shared.ts` — drop `SignalMessage`
- Modify: `packages/burger-shared/src/ecs.shared.ts` — drop `Radio`, `AudioEmitter`
- Modify: `packages/burger-shared/src/const.shared.ts` — drop `MESSAGE_TYPES.SIGNAL`
- Modify: `packages/burger-server/src/server.ts` — drop radio init, SIGTERM handlers, `radioEntities`
- Modify: `packages/burger-server/src/network.server.ts` — drop signal logic, `eidToWs`, `setRadioSignalHandler`, `sendSignalToPlayer`, `notifyPlayerDisconnect` import
- Modify: `packages/burger-server/src/level.ts` — drop `spawnRadio`, drop Radio entity case
- Modify: `packages/burger-server/src/players.ts` — drop `AudioEmitter` add
- Modify: `packages/burger-client/src/client.ts` — drop voice imports, `voiceSystem`, `setupAudioEmitterObserver`, `callAllEmitters`, voice GUI folder, `voiceState`
- Modify: `packages/burger-client/src/network.client.ts` — drop `sendSignal`, `onSignal`, SIGNAL case, `SignalMessage` import
- Modify: `packages/burger-client/src/consts.client.ts` — drop `VOICE_*`
- Modify: `packages/burger-client/vite.config.ts` — drop `nodePolyfills`
- Modify: `packages/burger-client/package.json` — drop `simple-peer`, `@types/simple-peer`, `vite-plugin-node-polyfills`
- Modify: `pnpm-workspace.yaml` — already covers all packages, no change
- Modify: `.gitignore` — drop `*.pcm`, `*.mp3`
- Modify: `Dockerfile` — drop `RUN npm install -g bun` (server is started via `pnpm prod:server` which uses bun via devDeps; verify)

- [ ] **Step 1:** Delete voice/radio source files

```bash
rm -rf packages/burger-radio
rm packages/burger-client/src/voice.client.ts
rm packages/burger-server/src/radio-manager.ts
```

- [ ] **Step 2:** Edit `packages/burger-shared/src/types.shared.ts` — replace entire file with:

```ts
export type InputCmd = {
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  interact: boolean;
};

export type PlayerState = {
  eid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastInputSeq: number;
};

export type GameStateMessage = {
  players: PlayerState[];
};
```

(Note: also drops `msec` from `InputCmd` for Task 4, but harmless to land here since wire format isn't validated yet.)

- [ ] **Step 3:** Edit `packages/burger-shared/src/ecs.shared.ts` — replace entire file with:

```ts
import { str } from "bitecs/serialization";

export const MAX_ENTITIES = 2000;

const Player = { name: str([]) };
const Position = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};
const Velocity = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};
const Tile = { type: [] as number[] };
const Networked = {};
const Solid = {};
const Bot = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Tile,
  Networked,
  Solid,
  Bot,
};

export const networkedComponents = [
  Player,
  Position,
  Tile,
  Solid,
  Bot,
];
```

(Note: changed `Tile.type` from `TileType[]` to `number[]` to break the import cycle; runtime values are unchanged. Re-exporting `TileType` from `const.shared` continues to work.)

- [ ] **Step 4:** Edit `packages/burger-shared/src/const.shared.ts` — drop `SIGNAL` from `MESSAGE_TYPES`:

```ts
export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  YOUR_EID: 3,
  INPUT: 4,
  GAME_STATE: 5,
  PING: 6,
  PONG: 7,
} as const;
```

- [ ] **Step 5:** Edit `packages/burger-server/src/network.server.ts` — drop signal-related code:
  - Remove `SignalMessage` import from `burger-shared`
  - Remove `notifyPlayerDisconnect` import from `./radio-manager`
  - Remove `eidToWs` map declaration
  - Remove `radioSignalHandler` variable + `setRadioSignalHandler` export
  - Remove `handleSignalMessage` function
  - Remove `sendSignalToPlayer` export
  - In `open(ws)`: remove `eidToWs.set(...)` line
  - In `close(ws)`: remove `eidToWs.delete(...)` and `notifyPlayerDisconnect(...)` lines
  - In `message(ws, message)`: replace the if/else with direct `handleInputMessage(connection, message)` call (still wrap in try/catch)

- [ ] **Step 6:** Edit `packages/burger-server/src/server.ts`:
  - Remove `radio-manager` import block
  - Remove `radioEntities: [] as number[]` from `createWorld` call
  - Remove `initRadios` function and its call
  - Remove `process.on("SIGTERM"|"SIGINT", ...)` handlers (Bun handles these)

- [ ] **Step 7:** Edit `packages/burger-server/src/level.ts`:
  - Remove `spawnRadio` function entirely
  - In `parseEntities`, remove the `case "Radio":` block
  - Remove `radioEntities` references

- [ ] **Step 8:** Edit `packages/burger-server/src/players.ts`:
  - Remove `AudioEmitter` from destructure and its `addComponent` + `peerId` line

- [ ] **Step 9:** Edit `packages/burger-client/src/consts.client.ts` — remove last two lines (`VOICE_MAX_DISTANCE`, `VOICE_MIN_DISTANCE`)

- [ ] **Step 10:** Edit `packages/burger-client/src/network.client.ts`:
  - Remove `SignalMessage` import
  - Remove `onSignal` field from `NetworkState`
  - Remove `case MESSAGE_TYPES.SIGNAL:` block
  - Remove `sendSignal` exported function

- [ ] **Step 11:** Edit `packages/burger-client/src/client.ts` — remove voice machinery:
  - Remove `voice.client` import block
  - Remove `AudioEmitter`, `Radio` from destructures
  - Remove `setupAudioEmitterObserver` function and its call
  - Remove `voiceState: VoiceState | null` from `Context`, replace with no entry; remove `voiceState: null` from context init
  - Remove `voiceSystem` function and its call in `update`
  - Remove `callAllEmitters` function and its calls in `setup`
  - Remove voice GUI folder block (`voiceFolder`, `voiceControls`, all `.add` chained calls)
  - Remove `me.serverEid` voice init in `onLocalPlayerReady` (keep the `Input` setup)
  - Remove `resetVoiceConnections` call in `onSocketClose`
  - Remove `onSignal` from `network` initial state
  - Remove unused `hasComponent` import if no longer used

- [ ] **Step 12:** Edit `packages/burger-client/vite.config.ts` — replace with:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://localhost:5000", changeOrigin: true },
      "/ws": {
        target: "ws://localhost:5000/",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 13:** Edit `packages/burger-client/package.json` — remove `simple-peer`, `@types/simple-peer` from dependencies; remove `vite-plugin-node-polyfills` from devDependencies.

- [ ] **Step 14:** Edit `.gitignore` — remove only the `*.pcm` and `*.mp3` lines. Keep `burger.json` and `v3` (server imports `burger.json`). Final .gitignore:

```
node_modules
.DS_Store
bitECS
tmp

burger.json
v3
```

- [ ] **Step 15:** Edit `Dockerfile` — drop `RUN npm install -g bun` line. The server runtime is `bun` via `pnpm prod:server` which uses `bun ./src/server.ts`. Bun must be available. Check the base image: `platformatic/node-caged:25-slim` — it's Node only, so Bun *is* needed. **Keep the `RUN npm install -g bun` line.** No change to Dockerfile this task.

- [ ] **Step 16:** Try to build. From repo root:

```bash
pnpm install
pnpm --filter burger-client build
```

Expected: TypeScript compiles, Vite builds. Fix any leftover voice/radio imports.

- [ ] **Step 17:** Verify server starts:

```bash
pnpm dev:server
```

Expected: "Server running on …:5000". Ctrl+C to stop.

- [ ] **Step 18:** Commit:

```bash
git add -A
git commit -m "chore: remove voice chat and radio streaming"
```

---

## Task 2: Bump dependencies

**Files:**
- Modify: `packages/burger-client/package.json`
- Modify: `packages/burger-server/package.json`
- Modify: `packages/burger-shared/package.json`
- Modify: `packages/burger-server/tsconfig.json`
- Modify: `package.json` (root)
- Regenerate: `pnpm-lock.yaml`

- [ ] **Step 1:** Edit `packages/burger-client/package.json` to set:

```json
{
  "name": "burger-client",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vite": "^8.0.11"
  },
  "dependencies": {
    "@types/debug": "^4.1.13",
    "bitecs": "^0.4.0",
    "burger-shared": "workspace:*",
    "debug": "^4.4.3",
    "lil-gui": "^0.21.0",
    "pixi.js": "^8.18.1"
  }
}
```

- [ ] **Step 2:** Edit `packages/burger-server/package.json` to set:

```json
{
  "name": "burger-server",
  "version": "0.1.0",
  "description": "hi, may i take your order?",
  "type": "module",
  "module": "index.ts",
  "scripts": {
    "dev": "DEBUG=burger:* bun --watch ./src/server.ts",
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

- [ ] **Step 3:** Edit `packages/burger-shared/package.json` to set:

```json
{
  "name": "burger-shared",
  "version": "0.1.0",
  "description": "hi, may i take your order?",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test"
  },
  "peerDependencies": {
    "debug": "^4.4.3",
    "bitecs": "^0.4.0",
    "typescript": "^6"
  },
  "devDependencies": {
    "@types/bun": "^1.3.13"
  }
}
```

- [ ] **Step 4:** Edit `packages/burger-server/tsconfig.json` to align with the others:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "types": ["bun"],
    "moduleDetection": "force",
    "allowJs": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "resolveJsonModule": true,

    "strict": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5:** Edit root `package.json`:

```json
{
  "name": "burger",
  "version": "0.1.0",
  "description": "hi, may i take your order?",
  "scripts": {
    "format": "pnpx prettier --write .",
    "dev:client": "pnpm --filter burger-client dev",
    "dev:server": "pnpm --filter burger-server dev",
    "build-frontend": "pnpm --filter burger-client build",
    "copy-frontend": "rm -rf ./packages/burger-server/public && cp -r ./packages/burger-client/dist/ ./packages/burger-server/public/",
    "prod:server": "pnpm --filter burger-server start",
    "test": "pnpm -r test"
  },
  "license": "ISC"
}
```

- [ ] **Step 6:** Reinstall:

```bash
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install
```

Expected: clean install, single new lockfile.

- [ ] **Step 7:** Verify build still works:

```bash
pnpm --filter burger-client build
```

Expected: success. If TypeScript 6 surfaces new errors, fix them inline before committing (most likely candidates: stricter never inference, exactOptionalPropertyTypes if it became default — it didn't, but check).

- [ ] **Step 8:** Verify server starts:

```bash
pnpm dev:server
```

Expected: "Server running on …:5000". Ctrl+C.

- [ ] **Step 9:** Commit:

```bash
git add -A
git commit -m "chore: bump dependencies to latest stable"
```

---

## Task 3: Introduce SharedWorld factory

**Files:**
- Create: `packages/burger-shared/src/world.shared.ts`
- Modify: `packages/burger-shared/src/index.ts`
- Modify: `packages/burger-shared/src/collision.ts`
- Modify: `packages/burger-server/src/server.ts`
- Modify: `packages/burger-client/src/client.ts`

- [ ] **Step 1:** Create `packages/burger-shared/src/world.shared.ts`:

```ts
import { createWorld } from "bitecs";
import { sharedComponents } from "./ecs.shared";

export const sharedWorldDefaults = () => ({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: performance.now() },
});

export const createSharedWorld = <Extra extends object>(extra: Extra) =>
  createWorld({ ...sharedWorldDefaults(), ...extra });

export type SharedWorld = ReturnType<typeof sharedWorldDefaults>;
```

- [ ] **Step 2:** Edit `packages/burger-shared/src/index.ts` to add `export * from "./world.shared";`.

- [ ] **Step 3:** Edit `packages/burger-shared/src/collision.ts`:
  - Drop the `import type { sharedComponents } from "./ecs.shared";` line
  - Drop the `import { type World } from "bitecs";` change to `import { query } from "bitecs";`
  - Change the signature to accept `SharedWorld`:

```ts
import { query } from "bitecs";
import { PLAYER_SIZE, TILE_SIZE } from "./const.shared";
import type { SharedWorld } from "./world.shared";

const CORNER_CORRECTION = 2;

export const moveAndSlide = (
  world: SharedWorld,
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  const { Position, Solid } = world.components;
  // …rest of function unchanged
```

- [ ] **Step 4:** Edit `packages/burger-server/src/server.ts` to use the factory:

Replace the `createWorld` call with:

```ts
const world = createSharedWorld({
  playerSpawns: [] as { x: number; y: number }[],
  typeIdToAtlasSrc: {} as Record<number, [number, number]>,
});

export type World = typeof world;
```

Drop the `import { createWorld, removeEntity } from "bitecs";` to `import { removeEntity } from "bitecs";`. Drop the `sharedComponents` import (the factory injects them). Add `import { createSharedWorld } from "burger-shared";`.

- [ ] **Step 5:** Edit `packages/burger-client/src/client.ts` similarly:

Replace `createWorld(...)` with `createSharedWorld(...)`. The client extends `components` further, so we need a variant that lets the caller add components too. Options:
  - (A) Have the caller spread `sharedComponents` themselves when extending. Simpler.
  - (B) Add a second generic for components.

Pick (A). Update the factory's contract: `createSharedWorld` is for callers who don't extend components. Callers who extend (the client) keep using `createWorld` directly but spread `sharedComponents`. This still gives the type benefit (`SharedWorld` is a stable subtype), and the structural compatibility is preserved.

So the client keeps:

```ts
import { createWorld } from "bitecs";
const world = createWorld({
  components: { ...sharedComponents, /* client extras */ },
  time: { ... },
  typeIdToAtlasSrc: { ... },
});
```

But shared functions still type-check because the client's world is structurally assignable to `SharedWorld`. Verify by checking that `moveAndSlide(world, …)` still type-checks in `client.ts`.

- [ ] **Step 6:** Build everything:

```bash
pnpm --filter burger-client build
pnpm dev:server  # start, Ctrl+C
```

Expected: both compile.

- [ ] **Step 7:** Commit:

```bash
git add -A
git commit -m "refactor: introduce SharedWorld factory and tighten shared boundary"
```

---

## Task 4: Harden netcode (validation, fixed-dt, version, cap)

**Files:**
- Modify: `packages/burger-shared/src/const.shared.ts` — add `PROTOCOL_VERSION`, `MAX_INPUTS_PER_TICK`
- Modify: `packages/burger-shared/src/types.shared.ts` — confirm no `msec`
- Modify: `packages/burger-shared/src/index.ts` — re-export new consts (already re-exports `const.shared`)
- Create: `packages/burger-server/src/input-validation.ts` — pure validator
- Modify: `packages/burger-server/src/network.server.ts`
- Modify: `packages/burger-server/src/server.ts`
- Modify: `packages/burger-client/src/network.client.ts`
- Modify: `packages/burger-client/src/client.ts` — drop `msec` from `InputCmd` send

- [ ] **Step 1:** Edit `packages/burger-shared/src/const.shared.ts` to add:

```ts
export const PROTOCOL_VERSION = 1;
export const MAX_INPUTS_PER_TICK = 8;
```

- [ ] **Step 2:** Confirm `packages/burger-shared/src/types.shared.ts` `InputCmd` has no `msec` (Task 1 already dropped it).

- [ ] **Step 3:** Create `packages/burger-server/src/input-validation.ts`:

```ts
import type { InputCmd } from "burger-shared";

export type ValidatedInput = InputCmd;

export const validateInput = (
  raw: unknown,
  lastSeq: number,
): ValidatedInput | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "input") return null;
  if (typeof r.seq !== "number" || !Number.isInteger(r.seq) || r.seq < 0) return null;
  if (r.seq <= lastSeq) return null;
  return {
    seq: r.seq,
    up: !!r.up,
    down: !!r.down,
    left: !!r.left,
    right: !!r.right,
    interact: !!r.interact,
  };
};
```

- [ ] **Step 4:** Edit `packages/burger-server/src/network.server.ts`:

  - Add `import { validateInput } from "./input-validation";`
  - Add `import { MAX_INPUTS_PER_TICK, PROTOCOL_VERSION } from "burger-shared";` (alongside existing imports)
  - In `PlayerConnection`, add `lastReceivedSeq: number;`
  - In `open(ws)`, init `lastReceivedSeq: -1`
  - In `open(ws)`, replace the `YOUR_EID` send with:

```ts
ws.sendBinary(
  tagMessage(
    MESSAGE_TYPES.YOUR_EID,
    new Int32Array([PROTOCOL_VERSION, eid]).buffer,
  ),
);
```

  - Replace `handleInputMessage` with:

```ts
const handleInputMessage = (connection: PlayerConnection, data: unknown): void => {
  const cmd = validateInput(data, connection.lastReceivedSeq);
  if (!cmd) return;
  connection.lastReceivedSeq = cmd.seq;
  connection.inputQueue.push(cmd);
  while (connection.inputQueue.length > 128) connection.inputQueue.shift();
};
```

  - In `processPlayerInputs`, cap inputs per tick:

```ts
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
```

  Note: signature dropped the `world` param — it was unused. Adjust caller.

- [ ] **Step 5:** Edit `packages/burger-server/src/server.ts`:
  - In `activeTick`, change `processPlayerInputs(world, ...)` to `processPlayerInputs(...)`
  - Pass `SERVER_TICK_RATE_MS` (not `cmd.msec`) into `applyInputToVelocity` and `moveAndSlide`:

```ts
processPlayerInputs((eid, cmd) => {
  invariant(Velocity.x[eid] !== undefined);
  // ...
  const newVel = applyInputToVelocity(
    Velocity.x[eid], Velocity.y[eid], cmd, SERVER_TICK_RATE_MS,
  );
  Velocity.x[eid] = newVel.vx;
  Velocity.y[eid] = newVel.vy;
  const newPos = moveAndSlide(
    world, Position.x[eid], Position.y[eid],
    Velocity.x[eid], Velocity.y[eid], SERVER_TICK_RATE_MS,
  );
  Position.x[eid] = newPos.x;
  Position.y[eid] = newPos.y;
});
```

- [ ] **Step 6:** Edit `packages/burger-client/src/network.client.ts`:
  - Add `import { PROTOCOL_VERSION, SERVER_TICK_RATE_MS } from "burger-shared";`
  - In the `YOUR_EID` case, parse `[version, eid]`:

```ts
case MESSAGE_TYPES.YOUR_EID: {
  const view = new Int32Array(payload);
  const version = view[0];
  if (version !== PROTOCOL_VERSION) {
    console.error(
      `Protocol version mismatch: server=${version} client=${PROTOCOL_VERSION}`,
    );
    network.socket?.close();
    return;
  }
  me.serverEid = view[1];
  break;
}
```

  - In `sendInputs`, drop `msec` from the JSON message:

```ts
const msg = JSON.stringify({
  type: "input",
  seq: cmd.seq,
  up: cmd.up,
  down: cmd.down,
  left: cmd.left,
  right: cmd.right,
  interact: cmd.interact,
});
```

  - In `reconcile`, replay unacked inputs at fixed dt instead of `cmd.msec`:

```ts
for (const cmd of pendingInputs) {
  const newVel = applyInputToVelocity(
    Velocity.x[eid], Velocity.y[eid], cmd, SERVER_TICK_RATE_MS,
  );
  Velocity.x[eid] = newVel.vx;
  Velocity.y[eid] = newVel.vy;
  const newPos = moveAndSlide(
    world, Position.x[eid], Position.y[eid],
    Velocity.x[eid], Velocity.y[eid], SERVER_TICK_RATE_MS,
  );
  Position.x[eid] = newPos.x;
  Position.y[eid] = newPos.y;
}
```

- [ ] **Step 7:** Edit `packages/burger-client/src/client.ts`:
  - In `predictionSystem`, drop `msec` from the `cmd` object construction (the type already requires it gone):

```ts
const cmd: InputCmd = {
  seq: network.inputSeq++,
  up: input.up,
  down: input.down,
  left: input.left,
  right: input.right,
  interact: input.interact,
};
```

- [ ] **Step 8:** Build & smoke-test:

```bash
pnpm --filter burger-client build
pnpm dev:server  # start, Ctrl+C
```

Expected: both compile, server starts.

- [ ] **Step 9:** Commit:

```bash
git add -A
git commit -m "feat: harden netcode against malicious clients"
```

---

## Task 5: Tests

**Files:**
- Create: `packages/burger-shared/test/physics.test.ts`
- Create: `packages/burger-shared/test/collision.test.ts`
- Create: `packages/burger-server/test/input-validation.test.ts`
- Create: `packages/burger-server/test/e2e.test.ts`

- [ ] **Step 1:** Create `packages/burger-shared/test/physics.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  applyInputToVelocity,
  applyVelocityToPosition,
  PLAYER_SPEED,
} from "burger-shared";

const noInput = { up: false, down: false, left: false, right: false };

test("applyInputToVelocity is deterministic", () => {
  const a = applyInputToVelocity(0, 0, { ...noInput, right: true }, 16);
  const b = applyInputToVelocity(0, 0, { ...noInput, right: true }, 16);
  expect(a).toEqual(b);
});

test("diagonal input is normalized", () => {
  const out = applyInputToVelocity(0, 0, { up: true, right: true, down: false, left: false }, 1000);
  // After ample time, should reach normalized speed components ~ PLAYER_SPEED / sqrt(2) each
  const target = PLAYER_SPEED / Math.SQRT2;
  expect(out.vx).toBeCloseTo(target, 1);
  expect(out.vy).toBeCloseTo(-target, 1);
});

test("friction decays velocity towards zero", () => {
  let vx = PLAYER_SPEED;
  let vy = 0;
  for (let i = 0; i < 200; i++) {
    const out = applyInputToVelocity(vx, vy, noInput, 16);
    vx = out.vx;
    vy = out.vy;
  }
  expect(Math.abs(vx)).toBeLessThan(0.001);
});

test("applyVelocityToPosition advances by vx*dt, vy*dt", () => {
  const out = applyVelocityToPosition(10, 20, 0.5, -0.25, 100);
  expect(out).toEqual({ x: 60, y: -5 });
});
```

- [ ] **Step 2:** Create `packages/burger-shared/test/collision.test.ts`:

```ts
import { expect, test } from "bun:test";
import { addEntity, addComponent } from "bitecs";
import {
  createSharedWorld,
  moveAndSlide,
  TILE_SIZE,
  PLAYER_SIZE,
} from "burger-shared";

const placeWall = (world: ReturnType<typeof createSharedWorld<{}>>, x: number, y: number) => {
  const { Position, Solid } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;
  addComponent(world, eid, Solid);
  return eid;
};

test("player stops at wall instead of passing through", () => {
  const world = createSharedWorld({});
  placeWall(world, 100, 0);
  // Player at (50, 0) moving right at high speed
  const out = moveAndSlide(world, 50, 0, 5, 0, 100);
  // Should be flush with the wall on the left side
  const expectedX = 100 - TILE_SIZE / 2 - PLAYER_SIZE / 2;
  expect(out.x).toBeLessThanOrEqual(expectedX + 0.001);
});

test("player slides along a vertical wall", () => {
  const world = createSharedWorld({});
  placeWall(world, 100, 0);
  // Player pushing right into wall while also moving down
  const out = moveAndSlide(world, 50, 0, 5, 1, 100);
  // Y should advance; X should be stopped
  expect(out.y).toBeGreaterThan(50);
});
```

- [ ] **Step 3:** Create `packages/burger-server/test/input-validation.test.ts`:

```ts
import { expect, test } from "bun:test";
import { validateInput } from "../src/input-validation";

test("valid input passes", () => {
  expect(
    validateInput(
      { type: "input", seq: 1, up: true, down: false, left: false, right: false, interact: false },
      0,
    ),
  ).toEqual({ seq: 1, up: true, down: false, left: false, right: false, interact: false });
});

test("rejects non-object input", () => {
  expect(validateInput(null, 0)).toBeNull();
  expect(validateInput("hi", 0)).toBeNull();
  expect(validateInput(42, 0)).toBeNull();
});

test("rejects wrong type", () => {
  expect(validateInput({ type: "signal", seq: 1 }, 0)).toBeNull();
});

test("rejects missing or non-integer seq", () => {
  expect(validateInput({ type: "input", seq: "x" }, 0)).toBeNull();
  expect(validateInput({ type: "input", seq: 1.5 }, 0)).toBeNull();
  expect(validateInput({ type: "input", seq: -1 }, 0)).toBeNull();
});

test("rejects replayed seq", () => {
  expect(validateInput({ type: "input", seq: 5 }, 5)).toBeNull();
  expect(validateInput({ type: "input", seq: 4 }, 5)).toBeNull();
});

test("coerces booleans", () => {
  const out = validateInput({ type: "input", seq: 1, up: 1, down: "x" }, 0);
  expect(out?.up).toBe(true);
  expect(out?.down).toBe(true);
});
```

- [ ] **Step 4:** Create `packages/burger-server/test/e2e.test.ts`:

```ts
import { expect, test } from "bun:test";
import { removeEntity } from "bitecs";
import {
  createSharedWorld,
  sharedComponents,
  applyInputToVelocity,
  moveAndSlide,
  SERVER_TICK_RATE_MS,
  PROTOCOL_VERSION,
  MAX_INPUTS_PER_TICK,
  MESSAGE_TYPES,
  type PlayerState,
} from "burger-shared";
import {
  createServer,
  getPlayerConnections,
  processPlayerInputs,
  broadcastGameState,
} from "../src/network.server";
import { createPlayer } from "../src/players";

const tick = (world: ReturnType<typeof createSharedWorld<{ playerSpawns: { x: number; y: number }[]; typeIdToAtlasSrc: Record<number, [number, number]> }>>) => {
  const { Position, Velocity } = world.components;
  processPlayerInputs((eid, cmd) => {
    const v = applyInputToVelocity(Velocity.x[eid], Velocity.y[eid], cmd, SERVER_TICK_RATE_MS);
    Velocity.x[eid] = v.vx;
    Velocity.y[eid] = v.vy;
    const p = moveAndSlide(world, Position.x[eid], Position.y[eid], Velocity.x[eid], Velocity.y[eid], SERVER_TICK_RATE_MS);
    Position.x[eid] = p.x;
    Position.y[eid] = p.y;
  });
  const states: PlayerState[] = [];
  for (const [, c] of getPlayerConnections()) {
    states.push({
      eid: c.eid, x: Position.x[c.eid]!, y: Position.y[c.eid]!,
      vx: Velocity.x[c.eid]!, vy: Velocity.y[c.eid]!, lastInputSeq: c.lastAckedSeq,
    });
  }
  broadcastGameState({ playerStates: states });
};

const setupTestServer = () => {
  const world = createSharedWorld({
    playerSpawns: [{ x: 0, y: 0 }],
    typeIdToAtlasSrc: {},
  });
  const port = 5000 + Math.floor(Math.random() * 1000);
  const app = createServer({
    port,
    world,
    onPlayerJoin: () => createPlayer(world, "Test"),
    onPlayerLeave: (eid) => removeEntity(world, eid),
  });
  return { world, app, port };
};

const connect = (port: number) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });

const collectMessages = (ws: WebSocket): { messages: Uint8Array[]; stop: () => void } => {
  const messages: Uint8Array[] = [];
  const handler = (e: MessageEvent) => messages.push(new Uint8Array(e.data as ArrayBuffer));
  ws.addEventListener("message", handler);
  return { messages, stop: () => ws.removeEventListener("message", handler) };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("server sends YOUR_EID with correct protocol version", async () => {
  const { app, port } = setupTestServer();
  const ws = await connect(port);
  const { messages } = collectMessages(ws);
  await sleep(50);
  const yourEid = messages.find((m) => m[0] === MESSAGE_TYPES.YOUR_EID);
  expect(yourEid).toBeDefined();
  const view = new Int32Array(yourEid!.slice(1).buffer);
  expect(view[0]).toBe(PROTOCOL_VERSION);
  expect(view[1]).toBeGreaterThan(0);
  ws.close();
  app.stop();
});

test("server moves player right when right inputs are sent", async () => {
  const { world, app, port } = setupTestServer();
  const ws = await connect(port);
  await sleep(50);
  const startX = (() => {
    for (const [, c] of getPlayerConnections()) return world.components.Position.x[c.eid];
    return 0;
  })();
  for (let i = 1; i <= 30; i++) {
    ws.send(JSON.stringify({ type: "input", seq: i, up: false, down: false, left: false, right: true, interact: false }));
  }
  await sleep(50);
  for (let i = 0; i < 5; i++) tick(world);
  let endX = startX;
  for (const [, c] of getPlayerConnections()) endX = world.components.Position.x[c.eid]!;
  expect(endX).toBeGreaterThan(startX!);
  ws.close();
  app.stop();
});

test("malicious client cannot speed-hack via input flood", async () => {
  const { world, app, port } = setupTestServer();
  const ws = await connect(port);
  await sleep(50);
  for (let i = 1; i <= 1000; i++) {
    ws.send(JSON.stringify({ type: "input", seq: i, up: false, down: false, left: false, right: true, interact: false }));
  }
  await sleep(50);
  // Single tick — must process at most MAX_INPUTS_PER_TICK
  tick(world);
  let pos = 0;
  for (const [, c] of getPlayerConnections()) pos = world.components.Position.x[c.eid]!;
  // One tick with capped inputs at fixed dt: bounded movement
  const maxPossible = MAX_INPUTS_PER_TICK * 1 * SERVER_TICK_RATE_MS; // very loose upper bound
  expect(Math.abs(pos)).toBeLessThan(maxPossible);
  ws.close();
  app.stop();
});

test("disconnect cleans up server-side state", async () => {
  const { app, port } = setupTestServer();
  const ws = await connect(port);
  await sleep(50);
  expect(getPlayerConnections().size).toBe(1);
  ws.close();
  await sleep(50);
  expect(getPlayerConnections().size).toBe(0);
  app.stop();
});
```

(Note: the `app.stop()` call uses Elysia's stop method. If the runtime returns a different shape, swap to `app.server?.stop()`.)

- [ ] **Step 5:** Run shared tests:

```bash
pnpm --filter burger-shared test
```

Expected: 4 tests pass for physics, 2 for collision.

- [ ] **Step 6:** Run server tests:

```bash
pnpm --filter burger-server test
```

Expected: 6 validation tests pass, 4 e2e tests pass. If e2e tests fail due to port conflict, rerun. If `app.stop()` is the wrong API, fix.

- [ ] **Step 7:** Run all tests via the root script:

```bash
pnpm test
```

Expected: all packages pass.

- [ ] **Step 8:** Commit:

```bash
git add -A
git commit -m "test: add Bun tests for physics, validation, and e2e netcode"
```

---

## Task 6: Open PR

- [ ] **Step 1:** Push branch:

```bash
git push -u origin modernize-and-drop-voice
```

- [ ] **Step 2:** Open PR via gh:

```bash
gh pr create --title "Modernize, drop voice/radio, harden netcode" --body "$(cat <<'EOF'
## Summary
- Drop voice chat and radio streaming entirely (~1.3kloc gone, 5 deps gone, native @roamhq/wrtc gone)
- Bump deps to latest stable (TypeScript 6, Vite 8, Pixi 8.18, Elysia 1.4.28, etc.)
- Introduce SharedWorld factory; tighten the boundary between burger-shared and game packages
- Harden netcode: validate & clamp incoming inputs, drop client-supplied dt (fixed-tick replay), per-tick input cap, protocol version handshake
- Add Bun test suite: physics determinism, collision behavior, input validation, e2e netcode against a real Elysia server

See `docs/superpowers/specs/2026-05-07-modernize-and-harden-design.md` for design rationale.
EOF
)"
```

- [ ] **Step 3:** Return PR URL.
