# Modernize, drop voice/radio, harden netcode

Status: approved
Date: 2026-05-07
Branch: `modernize-and-drop-voice`

## Goals

1. Remove voice chat and radio streaming entirely. They added significant complexity (~1.3kloc, native deps, child process IPC, WebRTC signaling) for marginal gameplay value.
2. Bump dependencies to latest stable.
3. Harden the boundary between `burger-shared` and game packages so shared physics has a single, well-typed entry point.
4. Harden netcode against malicious clients (speed-hack via client-supplied dt, malformed inputs, input flooding) and add a protocol version handshake.
5. Add a real test suite using `bun test`, including e2e netcode tests against a running server.

## Non-goals

- TODO.md quirks (`myEid` race, random freezes, disconnect bugs, entity recycling). Tracked separately.
- Gameplay (patties, cooking, pickup/place).
- Cleanup of the local `bitECS/` reference clone (already gitignored).
- Counter/level changes — level loading is fine as-is.

## What gets deleted

| Path                                                              | Reason                                        |
| ----------------------------------------------------------------- | --------------------------------------------- |
| `packages/burger-radio/`                                          | Entire package: radio audio streaming server. |
| `packages/burger-client/src/voice.client.ts`                      | WebRTC voice chat client.                     |
| `packages/burger-server/src/radio-manager.ts`                     | Subprocess manager for radio.                 |
| `AudioEmitter`, `Radio` ECS components                            | Only used by voice/radio.                     |
| `MESSAGE_TYPES.SIGNAL`                                            | WebRTC signaling relay.                       |
| `SignalMessage` type                                              | Same.                                         |
| `eidToWs` reverse map in network.server.ts                        | Only used by signal relay.                    |
| `world.radioEntities`, `spawnRadio`                               | Only used by radio.                           |
| Voice GUI controls in `client.ts`                                 | Voice settings folder.                        |
| `simple-peer`, `vite-plugin-node-polyfills`, `@types/simple-peer` | Browser WebRTC stack.                         |
| `tsx` (top-level dev)                                             | Only used by burger-radio.                    |
| `VOICE_MAX_DISTANCE`, `VOICE_MIN_DISTANCE` consts                 | Voice falloff.                                |
| `*.pcm`, `*.mp3` in .gitignore                                    | No longer relevant.                           |
| `nodePolyfills` plugin in vite.config.ts                          | Only there to make simple-peer build.         |

## Architecture changes

### Shared world factory

Today `collision.ts` accepts `World<{ components: Pick<typeof sharedComponents, "Position" | "Solid"> }>`. Both the client and server pass extended worlds that happen to satisfy this shape because they spread `sharedComponents`. This works structurally but is fragile — there's no compile-time guarantee the game's `createWorld` call covers the shared components, and shared signatures bloat with `Pick<>` lists.

Replace with a factory and a stable type:

```ts
// packages/burger-shared/src/world.shared.ts
import { createWorld } from "bitecs";
import { sharedComponents } from "./ecs.shared";

export const sharedWorldDefaults = () => ({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: performance.now() },
});

export const createSharedWorld = <Extra extends object>(extra: Extra) =>
  createWorld({ ...sharedWorldDefaults(), ...extra });

export type SharedWorld = ReturnType<typeof sharedWorldDefaults> & {
  components: typeof sharedComponents;
};
```

Shared functions accept `SharedWorld` directly. Game packages compose:

```ts
// server
const world = createSharedWorld({
  playerSpawns: [] as { x: number; y: number }[],
  typeIdToAtlasSrc: {} as Record<number, [number, number]>,
});

// client
const world = createSharedWorld({
  components: { ...sharedComponents, Sprite: [], DebugText: [], ... },
  typeIdToAtlasSrc: {} as ...
});
```

Shared functions stop reaching into `world.components` via `Pick<>` and instead destructure from the typed `SharedWorld`.

### Netcode hardening

**Server-driven physics dt.** `cmd.msec` is removed from the wire. The server replays each input at `SERVER_TICK_RATE_MS` (a constant). The client predicts using its real frame dt for responsiveness, but when reconciliation replays unacked inputs after a server snapshot, it uses the same fixed `SERVER_TICK_RATE_MS` so the prediction matches the server. This is how Source/Quake handles fixed-tick simulation.

**InputCmd validation.** Server runs every incoming message through a validator:

- Must be JSON object with `type === "input"`.
- `seq` is an integer ≥ 0 and > previous seq for that connection (drop reordered/replayed inputs).
- `up`/`down`/`left`/`right`/`interact` are booleans (cast).
- Anything else is rejected; counter logged via `debug`.
- `msec` is no longer accepted.

**Per-tick input cap.** `MAX_INPUTS_PER_TICK = 8`. If a client floods, surplus inputs are dropped from the front of the queue. Existing 128-entry queue cap stays.

**Protocol version.** New `PROTOCOL_VERSION = 1` constant. The server's `YOUR_EID` payload becomes `[version, eid]`. The client checks version on receipt and disconnects with a console error on mismatch.

### Wire format changes

- `InputCmd`: drops `msec`. New shape `{ seq, up, down, left, right, interact }`. Wire JSON: `{ type: "input", seq, up, down, left, right, interact }`.
- `MESSAGE_TYPES.SIGNAL` removed.
- `YOUR_EID` payload: `Int32Array([PROTOCOL_VERSION, eid])`.

### Modernization

- Bump bitecs, pixi.js, vite, elysia, typescript, debug, lil-gui, tiny-invariant, @elysiajs/static, @types/bun to latest stable. Regenerate lockfile.
- Server `tsconfig.json` aligned with shared/client (target ES2022, module ESNext, strict + same flags).
- Drop `vite-plugin-node-polyfills`, `simple-peer`, `tsx`, `@types/simple-peer`, `@roamhq/wrtc`.
- Dockerfile: keep `platformatic/node-caged:25-slim`, drop the `bun` global install (server is already executed via `bun` from `pnpm prod:server` script — confirm and adjust).

## Tests

Test runner: `bun test`. Run from each package and aggregated by a root `pnpm test` script.

### `packages/burger-shared/test/`

- **`physics.test.ts`** — determinism: given the same `(x, y, vx, vy, input, dt)`, `applyInputToVelocity` and `applyVelocityToPosition` produce identical results across multiple invocations. Diagonal input is normalized. Friction decays velocity. Acceleration approaches `PLAYER_SPEED`.
- **`collision.test.ts`** — `moveAndSlide`: a player moving into a wall stops at the wall; sliding along a wall preserves perpendicular motion; corner-correction nudges the player around a 1px wall corner.

### `packages/burger-server/test/`

- **`input-validation.test.ts`** — pure-function test of the input validator with table-driven cases: valid input passes, missing fields fail, non-boolean fields fail, non-integer seq fails, replayed seq is dropped, surplus inputs over `MAX_INPUTS_PER_TICK` are dropped.
- **`e2e.test.ts`** — spin up `createServer` on a random port, open a real `WebSocket` (Bun has it), drive a sequence of inputs, assert:
  1. Server sends `YOUR_EID` with correct protocol version.
  2. Server sends initial `SNAPSHOT`.
  3. After N inputs (move right), server's broadcast `GAME_STATE` shows the player has moved right.
  4. Speed-hack attempt: send 1000 inputs in one batch; server processes at most `MAX_INPUTS_PER_TICK` per tick, position is bounded.
  5. Disconnect cleans up server state.

## Branch & commit plan

Branch: `modernize-and-drop-voice`

1. `chore: remove voice chat and radio streaming` — pure deletion of all voice/radio code, deps, message types, components.
2. `chore: bump dependencies to latest stable` — package bumps, lockfile, tsconfig alignment.
3. `refactor: introduce SharedWorld factory and tighten shared boundary` — `world.shared.ts`, signature changes.
4. `feat: harden netcode against malicious clients` — input validation, fixed-dt replay, protocol version, per-tick input cap.
5. `test: add Bun tests for physics, validation, and e2e netcode` — full test suite.

Then open a PR: `Modernize, drop voice/radio, harden netcode`.

## Risks

- **Reconciliation behavior change.** Switching client replay to fixed dt may affect feel. Mitigated by tests + the fact that the _prediction_ tick still uses real dt.
- **bitecs major bump.** Check changelog; current is 0.4.0. If 0.5+ is breaking, fall back to 0.4.x latest.
- **Pixi.js v8 → v9 if it dropped.** Unlikely; v8 is current.
- **Elysia API drift.** v1.4 is current; bumps within 1.x should be fine.
