# Zones Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free-form zones that gate non-admin paint authorization. Admins create zones, paint their cell shapes, and assign users. The server rejects non-admin paint commands targeting cells outside any zone the user is a member of. Admins bypass the check.

**Architecture:** Three new SQLite tables (zones, zone_cells, zone_members). In-memory mirror on `world` (`world.zones`, `world.cellToZone`). Pure `canPaint` function wired into the existing WS paint handler. Admin REST endpoints for CRUD + cell/member mutation. Two new WS message types (`ZONES_UPDATED` admin-only, `MY_ZONES` per-user). New admin-only Zones window with zone-paint mode parallel to tile-paint.

**Tech Stack:** Bun + Elysia + bun:sqlite (server), bitecs ECS, React + Pixi.js + React Router + Eden Treaty + Zustand (client), oxlint, oxfmt, bun:test.

**Spec:** `docs/superpowers/specs/2026-05-13-zones-core-design.md`

---

## File Structure

### Server (new files)

- `packages/burger-server/src/zones.ts` — pure helpers: `loadZones(db, world)`, `canPaint(world, userId, x, y, isAdmin)`, `validateZoneName(name)`, `validateZoneCells(cells, world)`. No DB writes here — those live in `zone-mutations.ts` so they can be unit-tested.
- `packages/burger-server/src/zone-mutations.ts` — DB+memory mutation functions used by REST handlers: `createZone`, `renameZone`, `deleteZone`, `mutateZoneCells`, `setZoneMembers`. Each wraps a SQLite transaction then mirrors to `world.zones` / `world.cellToZone`. Returns a `MutationResult` with the data the broadcaster needs to drive `my_zones` updates (affected user ids).

### Server (modified files)

- `packages/burger-server/src/db.ts` — add three `CREATE TABLE IF NOT EXISTS` plus two indexes.
- `packages/burger-server/src/world.ts` — extend `World` type with `zones`, `cellToZone`; call `loadZones` from `loadWorld`.
- `packages/burger-server/src/network.server.ts` — replace `if (!connection.isAdmin) return;` in `handlePaintMessage` with `canPaint`. Add `broadcastZonesUpdated`, `sendMyZonesTo`. Send `MY_ZONES` on connect for non-admins.
- `packages/burger-server/src/app.ts` — add 7 endpoints under `/api/zones*` and a `/api/users` admin endpoint.
- `packages/burger-shared/src/const.shared.ts` — add `ZONES_UPDATED: 11`, `MY_ZONES: 12` to `MESSAGE_TYPES`.

### Client (new files)

- `packages/burger-client/src/windows/ZonesWindow.tsx` — list, create, rename, delete; selected-zone detail panel with members multi-select and "Enter zone-paint mode" button.
- `packages/burger-client/src/game/zones.ts` — pure state holder + overlay renderer: `ZonesState`, `setZones(state, list)`, `setSelectedZone(state, id)`, `redrawOverlay(state)`. Mirrors the pattern of `editor.ts`.

### Client (modified files)

- `packages/burger-client/src/store.ts` — Zustand slice for zones (admin: full list; non-admin: just `myZoneCells: Set<string>`).
- `packages/burger-client/src/windows/Taskbar.tsx` — add "Zones" button (admin-only).
- `packages/burger-client/src/windows/WindowManager.tsx` — register `WINDOW_ZONES`.
- `packages/burger-client/src/game/index.ts` — initialize `ZonesState`, mount overlay, dispatch `MY_ZONES`/`ZONES_UPDATED`.
- `packages/burger-client/src/game/network.ts` — handle new message types.
- `packages/burger-client/src/game/editor.ts` — `e` and `z` are mutually exclusive (entering zone-paint exits tile-paint and vice versa).

### Tests

- `packages/burger-server/test/zones.test.ts` — `canPaint`, `validateZoneName`, `validateZoneCells` (pure unit).
- `packages/burger-server/test/zone-mutations.test.ts` — DB-level: create/rename/delete, cell add/remove with overlap, member replace.
- `packages/burger-server/test/zones-e2e.test.ts` — HTTP + WS integration end-to-end.

---

## Conventions

- All work on `main` (per CLAUDE.md: small/independent commits, conventional commits). Each task ends with a commit.
- After every code change, run: `pnpm lint && pnpm fmt:check && pnpm --filter burger-server exec tsc --noEmit && pnpm --filter burger-client exec tsc --noEmit && pnpm --filter burger-server test --bail`.
- TILE_SIZE = 32; cell-center convention: x ≡ 16 (mod 32) and y ≡ 16 (mod 32). World bounds default 2048×2048 (64×64 cells).
- `"x,y"` keys are the canonical cell key shape; same as `world.tilesAtPosition`.

---

## Task 1: DB migrations for zones tables

**Files:**
- Modify: `packages/burger-server/src/db.ts`
- Test: `packages/burger-server/test/world.test.ts` (extend existing file with a new test)

- [ ] **Step 1: Write the failing test**

Append to `packages/burger-server/test/world.test.ts`:

```ts
test("zones, zone_cells, zone_members tables exist after migration", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("zones");
  expect(names).toContain("zone_cells");
  expect(names).toContain("zone_members");
  db.close();
});
```

If `Database` or `runMigrations` aren't imported in `world.test.ts`, add the imports:

```ts
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter burger-server test world.test.ts 2>&1 | tail -20
```

Expected: the new test fails ("zones" not found in table list).

- [ ] **Step 3: Add the migrations**

In `packages/burger-server/src/db.ts`, append inside `runMigrations` (after the `palettes` block, before the closing `};`):

```ts
  db.run(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS zone_cells (
      zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      PRIMARY KEY (zone_id, x, y)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS zone_cells_xy ON zone_cells(x, y)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS zone_members (
      zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (zone_id, user_id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS zone_members_user ON zone_members(user_id)`);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter burger-server test world.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full server test + lint to confirm no regressions**

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green; 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/src/db.ts packages/burger-server/test/world.test.ts
git commit -m "feat(server): add zones, zone_cells, zone_members tables"
```

---

## Task 2: `world.zones` and `world.cellToZone` in-memory state

**Files:**
- Modify: `packages/burger-server/src/world.ts`
- Create: `packages/burger-server/src/zones.ts` (just the type/loader stub for now)
- Test: extend `packages/burger-server/test/world.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/burger-server/test/world.test.ts`:

```ts
test("initWorld populates empty zones and cellToZone when DB has no rows", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const world = initWorld(db);
  expect(world.zones).toBeInstanceOf(Map);
  expect(world.zones.size).toBe(0);
  expect(world.cellToZone).toBeInstanceOf(Map);
  expect(world.cellToZone.size).toBe(0);
  db.close();
});

test("initWorld loads zone rows into world.zones and world.cellToZone", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (1, 'kitchen', 0)");
  db.run("INSERT INTO zones (id, name, created_at) VALUES (2, 'bar', 0)");
  db.run("INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES ('u1', 'fid-u1', 'u1', 0, 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (1, 16, 16)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (1, 48, 16)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (2, 80, 16)");
  db.run("INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (1, 'u1', 0)");

  const world = initWorld(db);

  expect(world.zones.size).toBe(2);
  const kitchen = world.zones.get(1)!;
  expect(kitchen.name).toBe("kitchen");
  expect(kitchen.cells.has("16,16")).toBe(true);
  expect(kitchen.cells.has("48,16")).toBe(true);
  expect(kitchen.members.has("u1")).toBe(true);

  expect(world.cellToZone.get("16,16")).toBe(1);
  expect(world.cellToZone.get("48,16")).toBe(1);
  expect(world.cellToZone.get("80,16")).toBe(2);
  db.close();
});
```

If `initWorld` isn't imported in `world.test.ts`, add:

```ts
import { initWorld } from "../src/world";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter burger-server test world.test.ts 2>&1 | tail -20
```

Expected: TypeScript error on `world.zones` / `world.cellToZone` (they don't exist yet) OR runtime failure.

- [ ] **Step 3: Create the zones type + loader stub**

Create `packages/burger-server/src/zones.ts`:

```ts
import type { Database } from "bun:sqlite";

export type ZoneRuntime = {
  id: number;
  name: string;
  cells: Set<string>;
  members: Set<string>;
};

export type ZonesState = {
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
};

export const loadZones = (db: Database): ZonesState => {
  const zones = new Map<number, ZoneRuntime>();
  const cellToZone = new Map<string, number>();

  const zoneRows = db
    .query("SELECT id, name FROM zones")
    .all() as { id: number; name: string }[];

  for (const z of zoneRows) {
    zones.set(z.id, {
      id: z.id,
      name: z.name,
      cells: new Set(),
      members: new Set(),
    });
  }

  const cellRows = db
    .query("SELECT zone_id, x, y FROM zone_cells")
    .all() as { zone_id: number; x: number; y: number }[];

  for (const c of cellRows) {
    const zone = zones.get(c.zone_id);
    if (!zone) continue;
    const key = `${c.x},${c.y}`;
    zone.cells.add(key);
    cellToZone.set(key, c.zone_id);
  }

  const memberRows = db
    .query("SELECT zone_id, user_id FROM zone_members")
    .all() as { zone_id: number; user_id: string }[];

  for (const m of memberRows) {
    const zone = zones.get(m.zone_id);
    if (!zone) continue;
    zone.members.add(m.user_id);
  }

  return { zones, cellToZone };
};
```

- [ ] **Step 4: Wire `zones` + `cellToZone` into the World type and `initWorld`**

In `packages/burger-server/src/world.ts`:

a) Add import at top of file:

```ts
import { loadZones, type ZoneRuntime } from "./zones";
```

b) Extend the `WorldExtras` type with the two new fields. Find the existing `WorldExtras` type (search `WorldExtras` in the file). Add:

```ts
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
```

c) Find the `return` block in `initWorld` (where `spawnZone` is added to the world object) and merge the zones state in:

```ts
  const zonesState = loadZones(db);

  return {
    // ... existing fields ...
    spawnZone,
    zones: zonesState.zones,
    cellToZone: zonesState.cellToZone,
  };
```

Place `const zonesState = loadZones(db);` just before the `return` statement so the loader runs after all other table reads are done.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter burger-server test world.test.ts 2>&1 | tail -20
```

Expected: both new tests PASS.

- [ ] **Step 6: Verify nothing else broke**

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/burger-server/src/zones.ts packages/burger-server/src/world.ts packages/burger-server/test/world.test.ts
git commit -m "feat(server): load zones into world.zones + world.cellToZone on boot"
```

---

## Task 3: Pure `canPaint` function with unit tests

**Files:**
- Modify: `packages/burger-server/src/zones.ts`
- Create: `packages/burger-server/test/zones.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/burger-server/test/zones.test.ts`:

```ts
import { expect, test, describe } from "bun:test";
import { canPaint } from "../src/zones";

const makeState = (
  zones: { id: number; cells: string[]; members: string[] }[],
) => {
  const zonesMap = new Map<
    number,
    { id: number; name: string; cells: Set<string>; members: Set<string> }
  >();
  const cellToZone = new Map<string, number>();
  for (const z of zones) {
    zonesMap.set(z.id, {
      id: z.id,
      name: `z${z.id}`,
      cells: new Set(z.cells),
      members: new Set(z.members),
    });
    for (const c of z.cells) cellToZone.set(c, z.id);
  }
  return { zones: zonesMap, cellToZone };
};

describe("canPaint", () => {
  test("admin always allowed, even outside any zone", () => {
    const w = makeState([]);
    expect(canPaint(w, "alice", 16, 16, true)).toBe(true);
  });

  test("non-admin allowed at cell inside their zone", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["alice"] }]);
    expect(canPaint(w, "alice", 16, 16, false)).toBe(true);
  });

  test("non-admin rejected at cell inside a zone they don't belong to", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["bob"] }]);
    expect(canPaint(w, "alice", 16, 16, false)).toBe(false);
  });

  test("non-admin rejected at cell that isn't in any zone", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["alice"] }]);
    expect(canPaint(w, "alice", 48, 48, false)).toBe(false);
  });

  test("non-admin rejected when zone id is stale (zone deleted between maps)", () => {
    // Simulate: cellToZone references zone 1, but zones map doesn't have 1.
    const zones = new Map<
      number,
      { id: number; name: string; cells: Set<string>; members: Set<string> }
    >();
    const cellToZone = new Map<string, number>([["16,16", 1]]);
    expect(canPaint({ zones, cellToZone }, "alice", 16, 16, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter burger-server test zones.test.ts 2>&1 | tail -10
```

Expected: import error on `canPaint`.

- [ ] **Step 3: Implement `canPaint`**

Append to `packages/burger-server/src/zones.ts`:

```ts
type CanPaintState = {
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
};

export const canPaint = (
  state: CanPaintState,
  userId: string,
  x: number,
  y: number,
  isAdmin: boolean,
): boolean => {
  if (isAdmin) return true;
  const zoneId = state.cellToZone.get(`${x},${y}`);
  if (zoneId === undefined) return false;
  const zone = state.zones.get(zoneId);
  return zone?.members.has(userId) ?? false;
};
```

Note: `CanPaintState` is a structural type so `canPaint` accepts either a `World` or a partial state. This lets us unit-test without constructing a full world.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter burger-server test zones.test.ts 2>&1 | tail -10
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run lint + typecheck + fmt**

```bash
pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 warnings, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/src/zones.ts packages/burger-server/test/zones.test.ts
git commit -m "feat(server): pure canPaint function for zone authorization"
```

---

## Task 4: Wire `canPaint` into the WS paint handler

**Files:**
- Modify: `packages/burger-server/src/network.server.ts`
- Test: extend `packages/burger-server/test/paint-e2e.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/burger-server/test/paint-e2e.test.ts`:

```ts
test("non-admin paint inside a zone they belong to succeeds", async () => {
  const sess = setupSession(db, false);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (10, 'z', 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (10, ?, ?)", [A_X, A_Y]);
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (10, 'user1', 0)",
  );
  // Reload world.zones / cellToZone since we wrote directly. Simplest: rehydrate.
  world.zones.set(10, {
    id: 10,
    name: "z",
    cells: new Set([`${A_X},${A_Y}`]),
    members: new Set(["user1"]),
  });
  world.cellToZone.set(`${A_X},${A_Y}`, 10);

  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT tile_id FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y) as { tile_id: number } | null;
  expect(tile?.tile_id).toBe(3);
  ws.close();
  await sleep(50);
});

test("non-admin paint outside any zone is rejected", async () => {
  const sess = setupSession(db, false);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT * FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y);
  expect(tile).toBeNull();
  ws.close();
  await sleep(50);
});

test("non-admin paint inside another user's zone is rejected", async () => {
  const sess = setupSession(db, false);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (11, 'z', 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (11, ?, ?)", [A_X, A_Y]);
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES ('bob', 'fid-bob', 'bob', 'bob', 0, 0)",
  );
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (11, 'bob', 0)",
  );
  world.zones.set(11, {
    id: 11,
    name: "z",
    cells: new Set([`${A_X},${A_Y}`]),
    members: new Set(["bob"]),
  });
  world.cellToZone.set(`${A_X},${A_Y}`, 11);

  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT * FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y);
  expect(tile).toBeNull();
  ws.close();
  await sleep(50);
});
```

Also UPDATE the existing test labelled `"non-admin paint is rejected"`. That test currently expects rejection because of the admin gate. After this task, the rejection reason is "no zone." The test still passes as-is (no zone exists, so non-admin can't paint). No change needed; just note that the semantics shifted.

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
pnpm --filter burger-server test paint-e2e.test.ts 2>&1 | tail -20
```

Expected: the "non-admin paint inside a zone they belong to succeeds" test FAILS because the handler still has the `if (!connection.isAdmin) return;` early bail.

- [ ] **Step 3: Replace the admin gate with `canPaint` in the paint handler**

In `packages/burger-server/src/network.server.ts`:

a) Add import at the top of the file (alongside other server imports):

```ts
import { canPaint } from "./zones";
```

b) Replace lines 168-173 (the body of `handlePaintMessage`). Current code:

```ts
  if (!connection.isAdmin) return;
  if (connection.paintsThisTick >= MAX_PAINTS_PER_TICK) return;
  const cmd = validatePaint(data, world, world.catalogIds);
  if (!cmd) return;
  connection.paintsThisTick++;
  applyPaint(world, db, cmd, connection.userId);
```

New code:

```ts
  if (connection.paintsThisTick >= MAX_PAINTS_PER_TICK) return;
  const cmd = validatePaint(data, world, world.catalogIds);
  if (!cmd) return;
  if (!canPaint(world, connection.userId, cmd.x, cmd.y, connection.isAdmin)) {
    debug(
      "paint_denied user=%s x=%d y=%d",
      connection.userId,
      cmd.x,
      cmd.y,
    );
    return;
  }
  connection.paintsThisTick++;
  applyPaint(world, db, cmd, connection.userId);
```

(`debug` is already imported via the existing `debug` namespace at the top of the file. If it's not, use `console.info` instead — check the existing imports.)

- [ ] **Step 4: Run paint-e2e tests to verify they pass**

```bash
pnpm --filter burger-server test paint-e2e.test.ts 2>&1 | tail -20
```

Expected: all paint-e2e tests PASS, including the three new ones.

- [ ] **Step 5: Run full test suite + lint + typecheck + fmt**

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/src/network.server.ts packages/burger-server/test/paint-e2e.test.ts
git commit -m "feat(server): gate non-admin paint via canPaint zone check"
```

---

## Task 5: Zone name + cell validators

**Files:**
- Modify: `packages/burger-server/src/zones.ts`
- Modify: `packages/burger-server/test/zones.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/burger-server/test/zones.test.ts`:

```ts
import { validateZoneName, validateZoneCells } from "../src/zones";

describe("validateZoneName", () => {
  test("trims and accepts 1-32 chars", () => {
    expect(validateZoneName("  kitchen  ")).toEqual({ ok: true, name: "kitchen" });
    expect(validateZoneName("a")).toEqual({ ok: true, name: "a" });
    expect(validateZoneName("a".repeat(32))).toEqual({
      ok: true,
      name: "a".repeat(32),
    });
  });

  test("rejects empty or whitespace-only", () => {
    expect(validateZoneName("").ok).toBe(false);
    expect(validateZoneName("   ").ok).toBe(false);
  });

  test("rejects >32 chars", () => {
    expect(validateZoneName("a".repeat(33)).ok).toBe(false);
  });

  test("rejects non-string", () => {
    expect(validateZoneName(undefined as unknown as string).ok).toBe(false);
    expect(validateZoneName(123 as unknown as string).ok).toBe(false);
  });
});

describe("validateZoneCells", () => {
  const bounds = { x: 0, y: 0, w: 2048, h: 2048 };

  test("accepts cell-center integer coords inside bounds", () => {
    const r = validateZoneCells([[16, 16], [48, 16]], bounds);
    expect(r.cells).toEqual([[16, 16], [48, 16]]);
    expect(r.dropped).toBe(0);
  });

  test("drops misaligned coords", () => {
    const r = validateZoneCells([[15, 16], [16, 16]], bounds);
    expect(r.cells).toEqual([[16, 16]]);
    expect(r.dropped).toBe(1);
  });

  test("drops out-of-bounds coords", () => {
    const r = validateZoneCells([[16, 16], [4096, 16]], bounds);
    expect(r.cells).toEqual([[16, 16]]);
    expect(r.dropped).toBe(1);
  });

  test("drops malformed entries", () => {
    const r = validateZoneCells(
      [[16, 16], "bad", [16], null, [1.5, 16]] as unknown as number[][],
      bounds,
    );
    expect(r.cells).toEqual([[16, 16]]);
    expect(r.dropped).toBe(4);
  });

  test("returns empty for non-array input", () => {
    const r = validateZoneCells("not an array" as unknown as number[][], bounds);
    expect(r.cells).toEqual([]);
    expect(r.dropped).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter burger-server test zones.test.ts 2>&1 | tail -15
```

Expected: import errors for `validateZoneName`, `validateZoneCells`.

- [ ] **Step 3: Implement the validators**

Append to `packages/burger-server/src/zones.ts`:

```ts
import { TILE_SIZE } from "burger-shared";

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

export const validateZoneName = (raw: unknown): NameValidation => {
  if (typeof raw !== "string") return { ok: false, error: "must be a string" };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "must not be empty" };
  if (name.length > 32) return { ok: false, error: "max 32 chars" };
  return { ok: true, name };
};

export type CellsValidation = {
  cells: [number, number][];
  dropped: number;
};

export const validateZoneCells = (
  raw: unknown,
  bounds: { x: number; y: number; w: number; h: number },
): CellsValidation => {
  if (!Array.isArray(raw)) return { cells: [], dropped: 0 };
  const halfTile = TILE_SIZE / 2;
  const cells: [number, number][] = [];
  let dropped = 0;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      dropped++;
      continue;
    }
    const [x, y] = entry;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      dropped++;
      continue;
    }
    if ((((x - halfTile) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE !== 0) {
      dropped++;
      continue;
    }
    if ((((y - halfTile) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE !== 0) {
      dropped++;
      continue;
    }
    if (x < bounds.x || x >= bounds.x + bounds.w) {
      dropped++;
      continue;
    }
    if (y < bounds.y || y >= bounds.y + bounds.h) {
      dropped++;
      continue;
    }
    cells.push([x as number, y as number]);
  }
  return { cells, dropped };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter burger-server test zones.test.ts 2>&1 | tail -15
```

Expected: all tests PASS (5 from earlier + 4 + 5 = 14 total).

- [ ] **Step 5: Lint + typecheck + fmt**

```bash
pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/src/zones.ts packages/burger-server/test/zones.test.ts
git commit -m "feat(server): validateZoneName + validateZoneCells"
```

---

## Task 6: Zone mutation functions (DB writes + memory mirror)

**Files:**
- Create: `packages/burger-server/src/zone-mutations.ts`
- Create: `packages/burger-server/test/zone-mutations.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/burger-server/test/zone-mutations.test.ts`:

```ts
import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db";
import { loadZones } from "../src/zones";
import {
  createZone,
  renameZone,
  deleteZone,
  mutateZoneCells,
  setZoneMembers,
} from "../src/zone-mutations";

let db: Database;
let zonesState: ReturnType<typeof loadZones>;
const bounds = { x: 0, y: 0, w: 2048, h: 2048 };

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES ('u1', 'fid-u1', 'u1', 'u1', 0, 0)",
  );
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES ('u2', 'fid-u2', 'u2', 'u2', 0, 0)",
  );
  zonesState = loadZones(db);
});

describe("createZone", () => {
  test("inserts a row, returns the new id, mirrors to state", () => {
    const r = createZone(db, zonesState, "kitchen");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBeGreaterThan(0);
    expect(r.name).toBe("kitchen");
    const row = db.query("SELECT name FROM zones WHERE id = ?").get(r.id) as
      | { name: string }
      | null;
    expect(row?.name).toBe("kitchen");
    expect(zonesState.zones.get(r.id)?.name).toBe("kitchen");
  });

  test("rejects duplicate name with conflict result", () => {
    createZone(db, zonesState, "kitchen");
    const r2 = createZone(db, zonesState, "kitchen");
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toBe("name_taken");
  });

  test("rejects invalid name", () => {
    const r = createZone(db, zonesState, "");
    expect(r.ok).toBe(false);
  });
});

describe("renameZone", () => {
  test("updates DB and state", () => {
    const c = createZone(db, zonesState, "kitchen");
    if (!c.ok) throw new Error("setup failed");
    const r = renameZone(db, zonesState, c.id, "bar");
    expect(r.ok).toBe(true);
    expect(zonesState.zones.get(c.id)?.name).toBe("bar");
    const row = db.query("SELECT name FROM zones WHERE id = ?").get(c.id) as
      | { name: string }
      | null;
    expect(row?.name).toBe("bar");
  });

  test("returns not_found for unknown id", () => {
    const r = renameZone(db, zonesState, 999, "x");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("not_found");
  });

  test("rejects duplicate name", () => {
    const a = createZone(db, zonesState, "a");
    const b = createZone(db, zonesState, "b");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const r = renameZone(db, zonesState, b.id, "a");
    expect(r.ok).toBe(false);
  });
});

describe("deleteZone", () => {
  test("cascades to cells + members; mirror is cleared; returns affected user ids", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    mutateZoneCells(db, zonesState, c.id, { add: [[16, 16]], remove: [] }, bounds);
    setZoneMembers(db, zonesState, c.id, ["u1", "u2"]);

    const r = deleteZone(db, zonesState, c.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.affectedUserIds.sort()).toEqual(["u1", "u2"]);
    expect(zonesState.zones.has(c.id)).toBe(false);
    expect(zonesState.cellToZone.has("16,16")).toBe(false);
    const cellRows = db
      .query("SELECT * FROM zone_cells WHERE zone_id = ?")
      .all(c.id);
    expect(cellRows.length).toBe(0);
  });

  test("returns not_found for unknown id", () => {
    const r = deleteZone(db, zonesState, 999);
    expect(r.ok).toBe(false);
  });
});

describe("mutateZoneCells", () => {
  test("adds cells; updates state and DB", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    const r = mutateZoneCells(
      db,
      zonesState,
      c.id,
      { add: [[16, 16], [48, 16]], remove: [] },
      bounds,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toBe(2);
    expect(zonesState.zones.get(c.id)?.cells.size).toBe(2);
    expect(zonesState.cellToZone.get("16,16")).toBe(c.id);
  });

  test("removes cells; updates state and DB", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    mutateZoneCells(
      db,
      zonesState,
      c.id,
      { add: [[16, 16], [48, 16]], remove: [] },
      bounds,
    );
    const r = mutateZoneCells(
      db,
      zonesState,
      c.id,
      { add: [], remove: [[16, 16]] },
      bounds,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBe(1);
    expect(zonesState.cellToZone.has("16,16")).toBe(false);
    expect(zonesState.cellToZone.get("48,16")).toBe(c.id);
  });

  test("overlap: adding cell already in another zone reassigns it (last-write-wins)", () => {
    const a = createZone(db, zonesState, "a");
    const b = createZone(db, zonesState, "b");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    mutateZoneCells(db, zonesState, a.id, { add: [[16, 16]], remove: [] }, bounds);
    const r = mutateZoneCells(
      db,
      zonesState,
      b.id,
      { add: [[16, 16]], remove: [] },
      bounds,
    );
    expect(r.ok).toBe(true);
    expect(zonesState.cellToZone.get("16,16")).toBe(b.id);
    expect(zonesState.zones.get(a.id)?.cells.has("16,16")).toBe(false);
    expect(zonesState.zones.get(b.id)?.cells.has("16,16")).toBe(true);
  });

  test("dropped count includes invalid coords", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    const r = mutateZoneCells(
      db,
      zonesState,
      c.id,
      { add: [[16, 16], [15, 16]], remove: [] },
      bounds,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toBe(1);
    expect(r.dropped).toBe(1);
  });

  test("not_found for unknown zone", () => {
    const r = mutateZoneCells(db, zonesState, 999, { add: [], remove: [] }, bounds);
    expect(r.ok).toBe(false);
  });
});

describe("setZoneMembers", () => {
  test("replaces membership; returns affected user ids (added+removed); dropped count for unknown ids", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    setZoneMembers(db, zonesState, c.id, ["u1"]);
    const r = setZoneMembers(db, zonesState, c.id, ["u2", "ghost"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.memberUserIds.sort()).toEqual(["u2"]);
    expect(r.dropped).toBe(1);
    expect(r.affectedUserIds.sort()).toEqual(["u1", "u2"]);
    expect(zonesState.zones.get(c.id)?.members.has("u1")).toBe(false);
    expect(zonesState.zones.get(c.id)?.members.has("u2")).toBe(true);
  });

  test("idempotent on no-op", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    setZoneMembers(db, zonesState, c.id, ["u1"]);
    const r = setZoneMembers(db, zonesState, c.id, ["u1"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.affectedUserIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter burger-server test zone-mutations.test.ts 2>&1 | tail -10
```

Expected: import errors.

- [ ] **Step 3: Implement `zone-mutations.ts`**

Create `packages/burger-server/src/zone-mutations.ts`:

```ts
import type { Database } from "bun:sqlite";
import { validateZoneName, validateZoneCells, type ZonesState } from "./zones";

type Bounds = { x: number; y: number; w: number; h: number };

export type CreateResult =
  | { ok: true; id: number; name: string }
  | { ok: false; error: "name_invalid" | "name_taken" };

export const createZone = (
  db: Database,
  state: ZonesState,
  rawName: unknown,
): CreateResult => {
  const v = validateZoneName(rawName);
  if (!v.ok) return { ok: false, error: "name_invalid" };
  const existing = db
    .query("SELECT id FROM zones WHERE name = ?")
    .get(v.name) as { id: number } | null;
  if (existing) return { ok: false, error: "name_taken" };
  const result = db.run(
    "INSERT INTO zones (name, created_at) VALUES (?, ?)",
    [v.name, Date.now()],
  );
  const id = Number(result.lastInsertRowid);
  state.zones.set(id, {
    id,
    name: v.name,
    cells: new Set(),
    members: new Set(),
  });
  return { ok: true, id, name: v.name };
};

export type RenameResult =
  | { ok: true; id: number; name: string }
  | { ok: false; error: "name_invalid" | "name_taken" | "not_found" };

export const renameZone = (
  db: Database,
  state: ZonesState,
  id: number,
  rawName: unknown,
): RenameResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  const v = validateZoneName(rawName);
  if (!v.ok) return { ok: false, error: "name_invalid" };
  if (v.name === zone.name) return { ok: true, id, name: v.name };
  const existing = db
    .query("SELECT id FROM zones WHERE name = ? AND id != ?")
    .get(v.name, id) as { id: number } | null;
  if (existing) return { ok: false, error: "name_taken" };
  db.run("UPDATE zones SET name = ? WHERE id = ?", [v.name, id]);
  zone.name = v.name;
  return { ok: true, id, name: v.name };
};

export type DeleteResult =
  | { ok: true; affectedUserIds: string[] }
  | { ok: false; error: "not_found" };

export const deleteZone = (
  db: Database,
  state: ZonesState,
  id: number,
): DeleteResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  const affected = [...zone.members];
  const tx = db.transaction(() => {
    db.run("DELETE FROM zones WHERE id = ?", [id]);
  });
  tx();
  for (const key of zone.cells) state.cellToZone.delete(key);
  state.zones.delete(id);
  return { ok: true, affectedUserIds: affected };
};

export type CellsDiff = {
  add: unknown;
  remove: unknown;
};

export type MutateCellsResult =
  | {
      ok: true;
      added: number;
      removed: number;
      dropped: number;
      affectedUserIds: string[];
    }
  | { ok: false; error: "not_found" };

export const mutateZoneCells = (
  db: Database,
  state: ZonesState,
  id: number,
  diff: CellsDiff,
  bounds: Bounds,
): MutateCellsResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  const addV = validateZoneCells(diff.add, bounds);
  const removeV = validateZoneCells(diff.remove, bounds);

  let added = 0;
  let removed = 0;

  const tx = db.transaction(() => {
    for (const [x, y] of removeV.cells) {
      const key = `${x},${y}`;
      if (!zone.cells.has(key)) continue;
      db.run("DELETE FROM zone_cells WHERE zone_id = ? AND x = ? AND y = ?", [
        id,
        x,
        y,
      ]);
      removed++;
    }
    for (const [x, y] of addV.cells) {
      const key = `${x},${y}`;
      // Last-write-wins overlap: if the cell is in another zone, evict it from there.
      const prev = state.cellToZone.get(key);
      if (prev !== undefined && prev !== id) {
        db.run("DELETE FROM zone_cells WHERE zone_id = ? AND x = ? AND y = ?", [
          prev,
          x,
          y,
        ]);
      }
      db.run(
        "INSERT INTO zone_cells (zone_id, x, y) VALUES (?, ?, ?) ON CONFLICT (zone_id, x, y) DO NOTHING",
        [id, x, y],
      );
      added++;
    }
  });
  tx();

  // Mirror to in-memory state after commit.
  for (const [x, y] of removeV.cells) {
    const key = `${x},${y}`;
    if (zone.cells.has(key)) {
      zone.cells.delete(key);
      state.cellToZone.delete(key);
    }
  }
  for (const [x, y] of addV.cells) {
    const key = `${x},${y}`;
    const prev = state.cellToZone.get(key);
    if (prev !== undefined && prev !== id) {
      const prevZone = state.zones.get(prev);
      prevZone?.cells.delete(key);
    }
    zone.cells.add(key);
    state.cellToZone.set(key, id);
  }

  return {
    ok: true,
    added,
    removed,
    dropped: addV.dropped + removeV.dropped,
    affectedUserIds: [...zone.members],
  };
};

export type SetMembersResult =
  | {
      ok: true;
      memberUserIds: string[];
      affectedUserIds: string[];
      dropped: number;
    }
  | { ok: false; error: "not_found" };

export const setZoneMembers = (
  db: Database,
  state: ZonesState,
  id: number,
  rawUserIds: unknown,
): SetMembersResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  if (!Array.isArray(rawUserIds)) {
    return { ok: false, error: "not_found" };
  }

  // Filter to known users.
  const valid: string[] = [];
  let dropped = 0;
  for (const raw of rawUserIds) {
    if (typeof raw !== "string") {
      dropped++;
      continue;
    }
    const row = db.query("SELECT id FROM users WHERE id = ?").get(raw) as
      | { id: string }
      | null;
    if (row) valid.push(raw);
    else dropped++;
  }

  const newSet = new Set(valid);
  const oldSet = new Set(zone.members);
  const affected = new Set<string>();
  for (const u of newSet) if (!oldSet.has(u)) affected.add(u);
  for (const u of oldSet) if (!newSet.has(u)) affected.add(u);

  const tx = db.transaction(() => {
    db.run("DELETE FROM zone_members WHERE zone_id = ?", [id]);
    for (const u of valid) {
      db.run(
        "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (?, ?, ?)",
        [id, u, Date.now()],
      );
    }
  });
  tx();

  zone.members = newSet;

  return {
    ok: true,
    memberUserIds: valid,
    affectedUserIds: [...affected],
    dropped,
  };
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter burger-server test zone-mutations.test.ts 2>&1 | tail -15
```

Expected: all PASS.

- [ ] **Step 5: Full suite + lint + typecheck + fmt**

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/src/zone-mutations.ts packages/burger-server/test/zone-mutations.test.ts
git commit -m "feat(server): zone-mutations module with create/rename/delete/cells/members"
```

---

## Task 7: REST endpoints for zones

**Files:**
- Modify: `packages/burger-server/src/app.ts`
- Create: `packages/burger-server/test/zones-e2e.test.ts`

This task adds 7 endpoints. Each one gets one HTTP integration test in the e2e file. Broadcast wiring comes in Task 8 (we'll add stubs here and connect them next task).

- [ ] **Step 1: Write the failing tests**

Create `packages/burger-server/test/zones-e2e.test.ts`:

```ts
import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { removeEntity } from "bitecs";
import { runMigrations } from "../src/db";
import { initWorld } from "../src/world";
import { createServer, getPlayerConnections } from "../src/network.server";
import { createPlayer } from "../src/players";
import { createSession } from "../src/auth/sessions";
import type { AuthConfig } from "../src/auth/config";

let db: Database;
let world: ReturnType<typeof initWorld>;
let app: ReturnType<typeof createServer>;
let port: number;

const authConfig: AuthConfig = {
  fourmUrl: "http://localhost:8000",
  burgerUrl: "http://localhost:5000",
  clientId: "burger",
  isProduction: false,
};

const setupSession = (database: Database, isAdmin: boolean, id?: string): string => {
  const userId = id ?? (isAdmin ? "admin1" : "user1");
  database.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, `fid-${userId}`, userId, userId, isAdmin ? 1 : 0, Date.now()],
  );
  return createSession(database, userId);
};

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  world = initWorld(db);
  port = 6300 + Math.floor(Math.random() * 100);
  app = createServer({
    port,
    world,
    db,
    authConfig,
    onPlayerJoin: (name) => createPlayer(world, name),
    onPlayerLeave: (eid) => removeEntity(world, eid),
  });
});

afterEach(async () => {
  const a = app as unknown as {
    stop?: (force?: boolean) => Promise<unknown>;
    server?: { stop?: (force?: boolean) => unknown };
  };
  const stopPromise = (async () => {
    if (typeof a.stop === "function") await a.stop.call(app, true);
    else if (typeof a.server?.stop === "function")
      await a.server.stop.call(a.server, true);
  })();
  await Promise.race([
    stopPromise,
    new Promise<void>((r) => setTimeout(r, 500)),
  ]);
  for (const [, c] of getPlayerConnections()) {
    try {
      removeEntity(world, c.eid);
    } catch {}
  }
  getPlayerConnections().clear();
  db.close();
});

const req = async (
  method: string,
  path: string,
  body: unknown,
  sessionId?: string,
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionId) headers.Cookie = `burger_session=${sessionId}`;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

test("non-admin GET /api/zones returns 403", async () => {
  const sess = setupSession(db, false);
  const { status } = await req("GET", "/api/zones", undefined, sess);
  expect(status).toBe(403);
});

test("admin GET /api/zones returns empty list initially", async () => {
  const sess = setupSession(db, true);
  const { status, data } = await req("GET", "/api/zones", undefined, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ zones: [] });
});

test("admin POST /api/zones creates zone", async () => {
  const sess = setupSession(db, true);
  const r = await req("POST", "/api/zones", { name: "kitchen" }, sess);
  expect(r.status).toBe(200);
  expect(r.data.name).toBe("kitchen");
  expect(typeof r.data.id).toBe("number");
});

test("admin POST /api/zones rejects duplicate name with 409", async () => {
  const sess = setupSession(db, true);
  await req("POST", "/api/zones", { name: "kitchen" }, sess);
  const r2 = await req("POST", "/api/zones", { name: "kitchen" }, sess);
  expect(r2.status).toBe(409);
});

test("admin PATCH /api/zones/:id renames", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "a" }, sess);
  const r = await req("PATCH", `/api/zones/${c.data.id}`, { name: "b" }, sess);
  expect(r.status).toBe(200);
  expect(r.data.name).toBe("b");
});

test("admin DELETE /api/zones/:id removes the zone", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  const d = await req("DELETE", `/api/zones/${c.data.id}`, undefined, sess);
  expect(d.status).toBe(200);
  const list = await req("GET", "/api/zones", undefined, sess);
  expect(list.data.zones).toEqual([]);
});

test("admin PUT /api/zones/:id/cells adds + removes cells", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  const put = await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [[16, 16], [48, 16]], remove: [] },
    sess,
  );
  expect(put.status).toBe(200);
  expect(put.data.added).toBe(2);

  const put2 = await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [], remove: [[16, 16]] },
    sess,
  );
  expect(put2.data.removed).toBe(1);

  expect(world.zones.get(c.data.id)?.cells.size).toBe(1);
});

test("admin PUT /api/zones/:id/members replaces membership", async () => {
  const sess = setupSession(db, true);
  setupSession(db, false, "alice");
  setupSession(db, false, "bob");
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  const r = await req(
    "PUT",
    `/api/zones/${c.data.id}/members`,
    { user_ids: ["alice", "ghost"] },
    sess,
  );
  expect(r.status).toBe(200);
  expect(r.data.member_user_ids).toEqual(["alice"]);
  expect(r.data.dropped).toBe(1);
});

test("admin GET /api/zones/all-cells returns per-zone cells", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [[16, 16]], remove: [] },
    sess,
  );
  const r = await req("GET", "/api/zones/all-cells", undefined, sess);
  expect(r.status).toBe(200);
  expect(r.data.zones).toEqual([{ id: c.data.id, cells: [[16, 16]] }]);
});

test("admin GET /api/users returns id + display_name list", async () => {
  const sess = setupSession(db, true);
  setupSession(db, false, "alice");
  const r = await req("GET", "/api/users", undefined, sess);
  expect(r.status).toBe(200);
  const ids = (r.data.users as { id: string }[]).map((u) => u.id).sort();
  expect(ids).toEqual(["admin1", "alice"]);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter burger-server test zones-e2e.test.ts 2>&1 | tail -10
```

Expected: all tests fail with 404 (endpoints don't exist).

- [ ] **Step 3: Add endpoints to `app.ts`**

In `packages/burger-server/src/app.ts`:

a) Add imports at the top of the file:

```ts
import {
  createZone,
  renameZone,
  deleteZone,
  mutateZoneCells,
  setZoneMembers,
} from "./zone-mutations";
```

b) Add a helper near `requireAdmin` (right after it):

```ts
  const zonesList = () => {
    return [...world.zones.values()].map((z) => ({
      id: z.id,
      name: z.name,
      member_user_ids: [...z.members],
      cell_count: z.cells.size,
    }));
  };

  const zonesState = { zones: world.zones, cellToZone: world.cellToZone };
```

c) Just BEFORE the final closing of the route chain (find the last `.get(...)` or `.post(...)` before `.listen(...)` or before the `return` of the builder — search for the catalog-rename block ending or similar and add immediately after the catalog routes), add these endpoints. Use the existing `requireAdmin` pattern:

```ts
      .get("/api/zones", ({ headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        return { zones: zonesList() };
      })
      .post("/api/zones", ({ body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const name = (body as { name?: unknown })?.name;
        const r = createZone(db, zonesState, name);
        if (!r.ok) {
          set.status = r.error === "name_taken" ? 409 : 400;
          return { ok: false, error: r.error };
        }
        return { id: r.id, name: r.name };
      })
      .patch("/api/zones/:id", ({ params, body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const id = Number(params.id);
        const name = (body as { name?: unknown })?.name;
        const r = renameZone(db, zonesState, id, name);
        if (!r.ok) {
          set.status =
            r.error === "name_taken"
              ? 409
              : r.error === "not_found"
                ? 404
                : 400;
          return { ok: false, error: r.error };
        }
        return { id: r.id, name: r.name };
      })
      .delete("/api/zones/:id", ({ params, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const id = Number(params.id);
        const r = deleteZone(db, zonesState, id);
        if (!r.ok) {
          set.status = 404;
          return { ok: false, error: r.error };
        }
        return { ok: true };
      })
      .put("/api/zones/:id/cells", ({ params, body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const id = Number(params.id);
        const b = body as { add?: unknown; remove?: unknown };
        const r = mutateZoneCells(
          db,
          zonesState,
          id,
          { add: b?.add, remove: b?.remove },
          world.bounds,
        );
        if (!r.ok) {
          set.status = 404;
          return { ok: false, error: r.error };
        }
        return {
          added: r.added,
          removed: r.removed,
          dropped: r.dropped,
        };
      })
      .put("/api/zones/:id/members", ({ params, body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const id = Number(params.id);
        const user_ids = (body as { user_ids?: unknown })?.user_ids;
        const r = setZoneMembers(db, zonesState, id, user_ids);
        if (!r.ok) {
          set.status = 404;
          return { ok: false, error: r.error };
        }
        return {
          member_user_ids: r.memberUserIds,
          dropped: r.dropped,
        };
      })
      .get("/api/zones/all-cells", ({ headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const zones = [...world.zones.values()].map((z) => ({
          id: z.id,
          cells: [...z.cells].map((key) => {
            const [x, y] = key.split(",").map(Number);
            return [x, y] as [number, number];
          }),
        }));
        return { zones };
      })
      .get("/api/users", ({ headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return { ok: false };
        }
        const users = db
          .query(
            "SELECT id, display_name FROM users ORDER BY display_name",
          )
          .all() as { id: string; display_name: string | null }[];
        return { users };
      })
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter burger-server test zones-e2e.test.ts 2>&1 | tail -30
```

Expected: all PASS.

- [ ] **Step 5: Full suite + lint + typecheck + fmt**

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/src/app.ts packages/burger-server/test/zones-e2e.test.ts
git commit -m "feat(server): REST endpoints for zones CRUD + cells + members + users list"
```

---

## Task 8: WS message types + server broadcasts

**Files:**
- Modify: `packages/burger-shared/src/const.shared.ts`
- Modify: `packages/burger-server/src/network.server.ts`
- Modify: `packages/burger-server/src/app.ts` (call broadcast from endpoint handlers)
- Modify: `packages/burger-server/test/zones-e2e.test.ts` (WS reception tests)

- [ ] **Step 1: Add message type tags**

In `packages/burger-shared/src/const.shared.ts`, extend `MESSAGE_TYPES`:

```ts
export const MESSAGE_TYPES = {
  // ... existing entries ...
  CATALOG_UPDATED: 10,
  ZONES_UPDATED: 11,
  MY_ZONES: 12,
} as const;
```

- [ ] **Step 2: Write the failing WS tests**

Append to `packages/burger-server/test/zones-e2e.test.ts`:

```ts
import { MESSAGE_TYPES } from "burger-shared";

const connect = (p: number, sid: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${p}/ws`, {
      headers: { Cookie: `burger_session=${sid}` },
    } as unknown as ConstructorParameters<typeof WebSocket>[1]);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(
      () => reject(new Error("WebSocket connect timeout")),
      2000,
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const collect = (ws: WebSocket, tag: number): Uint8Array[] => {
  const collected: Uint8Array[] = [];
  ws.addEventListener("message", (e) => {
    const buf = new Uint8Array(e.data as ArrayBuffer);
    if (buf[0] === tag) collected.push(buf.subarray(1));
  });
  return collected;
};

const parseJson = (buf: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(buf));

test("non-admin receives MY_ZONES on connect", async () => {
  const sess = setupSession(db, false);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (50, 'z', 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (50, 16, 16)");
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (50, 'user1', 0)",
  );
  world.zones.set(50, {
    id: 50,
    name: "z",
    cells: new Set(["16,16"]),
    members: new Set(["user1"]),
  });
  world.cellToZone.set("16,16", 50);

  const ws = await connect(port, sess);
  const messages = collect(ws, MESSAGE_TYPES.MY_ZONES);
  await sleep(80);
  expect(messages.length).toBeGreaterThanOrEqual(1);
  const msg = parseJson(messages[0]!) as { cells: [number, number][] };
  expect(msg.cells).toEqual([[16, 16]]);
  ws.close();
  await sleep(50);
});

test("admin does not receive MY_ZONES on connect", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  const messages = collect(ws, MESSAGE_TYPES.MY_ZONES);
  await sleep(80);
  expect(messages.length).toBe(0);
  ws.close();
  await sleep(50);
});

test("admin receives ZONES_UPDATED after a zone mutation", async () => {
  const adminSess = setupSession(db, true);
  const ws = await connect(port, adminSess);
  const messages = collect(ws, MESSAGE_TYPES.ZONES_UPDATED);
  await sleep(50);
  await req("POST", "/api/zones", { name: "newzone" }, adminSess);
  await sleep(80);
  expect(messages.length).toBeGreaterThanOrEqual(1);
  ws.close();
  await sleep(50);
});

test("affected non-admin receives MY_ZONES when added to a zone", async () => {
  const adminSess = setupSession(db, true);
  const userSess = setupSession(db, false, "alice");
  const userWs = await connect(port, userSess);
  const messages = collect(userWs, MESSAGE_TYPES.MY_ZONES);
  await sleep(50);
  // Clear the initial empty MY_ZONES message.
  messages.length = 0;

  const c = await req("POST", "/api/zones", { name: "z" }, adminSess);
  await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [[16, 16]], remove: [] },
    adminSess,
  );
  await req(
    "PUT",
    `/api/zones/${c.data.id}/members`,
    { user_ids: ["alice"] },
    adminSess,
  );
  await sleep(80);
  expect(messages.length).toBeGreaterThanOrEqual(1);
  const last = parseJson(messages.at(-1)!) as { cells: [number, number][] };
  expect(last.cells).toEqual([[16, 16]]);
  userWs.close();
  await sleep(50);
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter burger-server test zones-e2e.test.ts 2>&1 | tail -20
```

Expected: WS tests fail (no broadcasts wired yet).

- [ ] **Step 4: Add broadcast helpers in `network.server.ts`**

In `packages/burger-server/src/network.server.ts`:

a) Add a `userIdToWs` lookup. Find the `playerConnections` map declaration and add right below:

```ts
const userIdToWs = new Map<string, WS>();
```

b) In the connection-add code path (search for `playerConnections.set(ws, {` — currently around line 114), after the `playerConnections.set(...)` call, add:

```ts
  userIdToWs.set(connection.userId, ws);
```

Where `connection.userId` matches the existing field. (If the local variable name differs, use the equivalent.)

c) In the connection-remove path (search for `playerConnections.delete(ws)` — currently around line 124), add right before it:

```ts
  const conn = playerConnections.get(ws);
  if (conn) userIdToWs.delete(conn.userId);
```

d) Append two new exported broadcast helpers after `broadcastCatalogUpdated`:

```ts
export const broadcastZonesUpdated = (): void => {
  if (playerConnections.size === 0) return;
  const tagged = new Uint8Array(1);
  tagged[0] = MESSAGE_TYPES.ZONES_UPDATED;
  for (const [ws, conn] of playerConnections) {
    if (!conn.isAdmin) continue;
    ws.sendBinary(tagged);
  }
  debug("zones_updated broadcast to admins");
};

export const sendMyZonesTo = (
  userId: string,
  cells: [number, number][],
): void => {
  const ws = userIdToWs.get(userId);
  if (!ws) return;
  const conn = playerConnections.get(ws);
  if (!conn || conn.isAdmin) return;
  const json = JSON.stringify({ cells });
  const payload = textEncoder.encode(json);
  const tagged = new Uint8Array(payload.byteLength + 1);
  tagged[0] = MESSAGE_TYPES.MY_ZONES;
  tagged.set(payload, 1);
  ws.sendBinary(tagged);
};
```

e) In the connection-add path (where we wrote `userIdToWs.set(...)` above), immediately after that, for non-admin connections, compute and send their initial `MY_ZONES`. Add:

```ts
  if (!connection.isAdmin) {
    const cells: [number, number][] = [];
    for (const z of world.zones.values()) {
      if (!z.members.has(connection.userId)) continue;
      for (const key of z.cells) {
        const [x, y] = key.split(",").map(Number);
        cells.push([x, y]);
      }
    }
    sendMyZonesTo(connection.userId, cells);
  }
```

Note: `world` is in scope inside `createServer` — it's the function arg. The connection-add path runs inside `createServer`, so it should be accessible. If `world` isn't in scope there, lift the on-connect logic to a callback or pass `world` through.

- [ ] **Step 5: Wire broadcasts into REST endpoint handlers in `app.ts`**

In `packages/burger-server/src/app.ts`:

a) Add import:

```ts
import { broadcastZonesUpdated, sendMyZonesTo } from "./network.server";
```

b) Add a helper near the other zone helpers:

```ts
  const sendMyZonesToAffected = (userIds: string[]) => {
    for (const userId of userIds) {
      const cells: [number, number][] = [];
      for (const z of world.zones.values()) {
        if (!z.members.has(userId)) continue;
        for (const key of z.cells) {
          const [x, y] = key.split(",").map(Number);
          cells.push([x, y]);
        }
      }
      sendMyZonesTo(userId, cells);
    }
  };
```

c) After each successful mutation (`createZone`, `renameZone`, `deleteZone`, `mutateZoneCells`, `setZoneMembers`), call `broadcastZonesUpdated()`. For mutations that have an `affectedUserIds`, call `sendMyZonesToAffected(r.affectedUserIds)`.

For example, the POST /api/zones handler ends:

```ts
  return { id: r.id, name: r.name };
```

Change to:

```ts
  broadcastZonesUpdated();
  return { id: r.id, name: r.name };
```

For PUT /api/zones/:id/cells:

```ts
  broadcastZonesUpdated();
  sendMyZonesToAffected(r.affectedUserIds);
  return {
    added: r.added,
    removed: r.removed,
    dropped: r.dropped,
  };
```

For PUT /api/zones/:id/members:

```ts
  broadcastZonesUpdated();
  sendMyZonesToAffected(r.affectedUserIds);
  return {
    member_user_ids: r.memberUserIds,
    dropped: r.dropped,
  };
```

For PATCH /api/zones/:id (rename):

```ts
  broadcastZonesUpdated();
  return { id: r.id, name: r.name };
```

For DELETE /api/zones/:id:

```ts
  broadcastZonesUpdated();
  sendMyZonesToAffected(r.affectedUserIds);
  return { ok: true };
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --filter burger-server test 2>&1 | tail -10
```

Expected: all tests pass, including the new WS reception tests.

- [ ] **Step 7: Lint + typecheck + fmt**

```bash
pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green. The shared package's new MESSAGE_TYPES entries will type-check both client and server.

- [ ] **Step 8: Commit**

```bash
git add packages/burger-shared/src/const.shared.ts packages/burger-server/src/network.server.ts packages/burger-server/src/app.ts packages/burger-server/test/zones-e2e.test.ts
git commit -m "feat(server): ZONES_UPDATED + MY_ZONES WS broadcasts wired into REST handlers"
```

---

## Task 9: Client store + WS dispatch for zones messages

**Files:**
- Modify: `packages/burger-client/src/store.ts`
- Modify: `packages/burger-client/src/game/network.ts`
- Modify: `packages/burger-client/src/game/index.ts`

No tests for client-side code in this spec (per spec's "Testing Strategy" — admin painter is manually smoke-tested). We do still verify by typecheck + fmt + lint and manual smoke at the end.

- [ ] **Step 1: Add a zones slice to the store**

In `packages/burger-client/src/store.ts`, define types and a new slice. Find the existing slice definitions (e.g. `palette` slice) and follow the same pattern. Add:

```ts
export type ZoneEntry = {
  id: number;
  name: string;
  member_user_ids: string[];
  cell_count: number;
};

type ZonesSlice = {
  // Admin: full zone list + per-zone cells
  list: ZoneEntry[];
  cellsByZone: Map<number, [number, number][]>;
  selectedId: number | null;
  // Non-admin: union of paintable cells
  myZoneCells: Set<string>;
};

const zonesSlice = (): ZonesSlice => ({
  list: [],
  cellsByZone: new Map(),
  selectedId: null,
  myZoneCells: new Set(),
});
```

Then in the combined store, expose it under a `zones` key and a setter pair:

```ts
zones: zonesSlice(),
setZones: (list: ZoneEntry[]) =>
  set((s) => ({ zones: { ...s.zones, list } })),
setZoneCells: (cellsByZone: Map<number, [number, number][]>) =>
  set((s) => ({ zones: { ...s.zones, cellsByZone } })),
setSelectedZone: (selectedId: number | null) =>
  set((s) => ({ zones: { ...s.zones, selectedId } })),
setMyZoneCells: (cells: [number, number][]) =>
  set((s) => ({
    zones: {
      ...s.zones,
      myZoneCells: new Set(cells.map(([x, y]) => `${x},${y}`)),
    },
  })),
```

Match the existing style (the file uses Zustand; if you're unsure, replicate the `palette` slice).

- [ ] **Step 2: Add an admin fetcher helper for zones**

In `packages/burger-client/src/store.ts` or a new helper file (whichever fits the existing style — check where `fetchCatalog` lives, place this beside it). Add:

```ts
export const refetchZones = async () => {
  const [listRes, cellsRes] = await Promise.all([
    fetch("/api/zones").then((r) => (r.ok ? r.json() : { zones: [] })),
    fetch("/api/zones/all-cells").then((r) =>
      r.ok ? r.json() : { zones: [] },
    ),
  ]);
  const cellsByZone = new Map<number, [number, number][]>();
  for (const z of cellsRes.zones as { id: number; cells: [number, number][] }[]) {
    cellsByZone.set(z.id, z.cells);
  }
  useStore.getState().setZones(listRes.zones as ZoneEntry[]);
  useStore.getState().setZoneCells(cellsByZone);
};
```

(If using Eden Treaty for the rest of the calls, mirror that pattern. The above uses raw fetch as a fallback example.)

- [ ] **Step 3: Dispatch the new WS message types**

In `packages/burger-client/src/game/network.ts`, add the new cases to the `switch (tag)` block:

```ts
        case MESSAGE_TYPES.ZONES_UPDATED: {
          // Admin refetch. Non-admins never receive this so no guard needed.
          refetchZones();
          break;
        }
        case MESSAGE_TYPES.MY_ZONES: {
          const json = new TextDecoder().decode(buf.subarray(1));
          const parsed = JSON.parse(json) as { cells: [number, number][] };
          useStore.getState().setMyZoneCells(parsed.cells);
          break;
        }
```

Add necessary imports at the top:

```ts
import { useStore, refetchZones } from "../store";
```

(Adjust based on actual export paths.)

- [ ] **Step 4: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Manual smoke (optional but recommended)**

```bash
pnpm dev
```

In two browser tabs, log in as admin in one. Open browser devtools network → WS tab. Confirm `ZONES_UPDATED` (single byte 11) arrives after a curl POST creates a zone:

```bash
curl -X POST -H "Content-Type: application/json" -H "Cookie: burger_session=<sess>" -d '{"name":"test"}' http://localhost:5000/api/zones
```

Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-client/src/store.ts packages/burger-client/src/game/network.ts
git commit -m "feat(client): zones store slice + WS message dispatch"
```

---

## Task 10: Client zones overlay renderer (admin paint mode)

**Files:**
- Create: `packages/burger-client/src/game/zones.ts`
- Modify: `packages/burger-client/src/game/index.ts`
- Modify: `packages/burger-client/src/game/editor.ts`

- [ ] **Step 1: Create `zones.ts` overlay state**

Create `packages/burger-client/src/game/zones.ts`:

```ts
import { Container, Graphics, type Application } from "pixi.js";
import { TILE_SIZE } from "burger-shared";

export type ZonesGameState = {
  active: boolean;
  selectedZoneId: number | null;
  cellsByZone: Map<number, [number, number][]>;
  overlay: Graphics;
};

const zoneColor = (id: number): number => {
  // Golden-angle hue spread, fully saturated medium-lightness.
  const hue = (id * 137.5) % 360;
  // Simple HSL -> RGB inline.
  const h = hue / 60;
  const c = 0.4; // chroma at sat=0.6, light=0.5: 2*0.5*0.6 = 0.6 — using 0.4 for less screaming.
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (h < 1) [r, g, b] = [c, x, 0];
  else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x];
  else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = 0.3;
  return (
    (Math.round((r + m) * 255) << 16) |
    (Math.round((g + m) * 255) << 8) |
    Math.round((b + m) * 255)
  );
};

export const initZonesGame = (app: Application): ZonesGameState => {
  const overlay = new Graphics();
  app.stage.addChild(overlay);
  overlay.visible = false;
  return {
    active: false,
    selectedZoneId: null,
    cellsByZone: new Map(),
    overlay,
  };
};

export const setZonesActive = (state: ZonesGameState, active: boolean): void => {
  state.active = active;
  state.overlay.visible = active;
  if (active) redrawZonesOverlay(state);
};

export const setZonesData = (
  state: ZonesGameState,
  cellsByZone: Map<number, [number, number][]>,
  selectedZoneId: number | null,
): void => {
  state.cellsByZone = cellsByZone;
  state.selectedZoneId = selectedZoneId;
  if (state.active) redrawZonesOverlay(state);
};

export const redrawZonesOverlay = (state: ZonesGameState): void => {
  const g = state.overlay;
  g.clear();
  const halfTile = TILE_SIZE / 2;
  for (const [zoneId, cells] of state.cellsByZone) {
    const color = zoneColor(zoneId);
    const alpha = zoneId === state.selectedZoneId ? 0.5 : 0.2;
    for (const [x, y] of cells) {
      g.rect(x - halfTile, y - halfTile, TILE_SIZE, TILE_SIZE).fill({
        color,
        alpha,
      });
    }
  }
};
```

- [ ] **Step 2: Wire `ZonesGameState` into the game context**

In `packages/burger-client/src/game/index.ts`:

a) Add imports:

```ts
import {
  initZonesGame,
  setZonesActive,
  setZonesData,
  type ZonesGameState,
} from "./zones";
import { useStore } from "../store";
```

b) Find the `Context` type definition and add `zones: ZonesGameState`.

c) In `startGame`, where the editor is initialized, also initialize zones:

```ts
const zones = initZonesGame(app);
```

And include it in the context:

```ts
const context: Context = {
  // ... existing fields ...
  zones,
};
```

d) Subscribe to the store. After the existing palette subscription, add:

```ts
useStore.subscribe((s) => s.zones, (z) => {
  setZonesData(zones, z.cellsByZone, z.selectedId);
});
```

(Match the existing subscription style — Zustand's selector subscribe.)

- [ ] **Step 3: Add `z` toggle for zone-paint mode in `editor.ts`**

In `packages/burger-client/src/game/editor.ts`, find the existing `e`-key toggle and the `Tab`-key toggle. Add a `z`-key toggle that:

- Exits tile-paint mode (`state.active = false`).
- Calls `setZonesActive(context.zones, true)` (or similar — depends on how state is reachable; if you don't have a direct context reference inside `initEditor`, accept a callback `onToggleZonePaint` from the caller).

Cleanest pattern: add an `onTogglePaintMode` callback to `initEditor`, which `startGame` provides. It accepts `"tile" | "zone"`. The editor reads it on `z` and `e` keys.

Sketch in `initEditor`:

```ts
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.target instanceof HTMLTextAreaElement) return;
  if ((e.target as HTMLElement)?.isContentEditable) return;
  if (e.key === "e" || e.key === "Tab") {
    state.active = !state.active;
    if (state.active) opts.onTogglePaintMode?.("tile");
    else opts.onTogglePaintMode?.("none");
  }
  if (e.key === "z") {
    state.active = false;
    opts.onTogglePaintMode?.("zone");
  }
  // ... existing palette hotkey handling
});
```

In `startGame`:

```ts
const editor = initEditor(app, world, {
  // ... existing options ...
  onTogglePaintMode: (mode) => {
    setZonesActive(zones, mode === "zone");
  },
});
```

- [ ] **Step 4: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Manual smoke**

```bash
pnpm dev
```

Log in as admin. Press `z`. With browser devtools open, run in console:

```js
window.context.zones.active
```

Expected: `true`. Press `e`: false.

Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-client/src/game/zones.ts packages/burger-client/src/game/index.ts packages/burger-client/src/game/editor.ts
git commit -m "feat(client): zones overlay + z key toggles zone-paint mode"
```

---

## Task 11: Click handling for zone-paint (add/remove cells)

**Files:**
- Modify: `packages/burger-client/src/game/zones.ts` (add stroke accumulator)
- Modify: `packages/burger-client/src/game/index.ts` (wire mousedown/mouseup)

- [ ] **Step 1: Add stroke accumulator to `zones.ts`**

In `packages/burger-client/src/game/zones.ts`, extend `ZonesGameState`:

```ts
export type ZonesGameState = {
  active: boolean;
  selectedZoneId: number | null;
  cellsByZone: Map<number, [number, number][]>;
  overlay: Graphics;
  // Pending stroke: cells the user has clicked/dragged this stroke.
  // Sign: +1 = add, -1 = remove.
  pendingAdd: Set<string>;
  pendingRemove: Set<string>;
  isDragging: boolean;
  dragButton: "left" | "right" | null;
};
```

Update `initZonesGame` to seed those fields:

```ts
  return {
    active: false,
    selectedZoneId: null,
    cellsByZone: new Map(),
    overlay,
    pendingAdd: new Set(),
    pendingRemove: new Set(),
    isDragging: false,
    dragButton: null,
  };
```

Add helpers:

```ts
export const beginZoneStroke = (
  state: ZonesGameState,
  button: "left" | "right",
): void => {
  state.isDragging = true;
  state.dragButton = button;
  state.pendingAdd.clear();
  state.pendingRemove.clear();
};

export const extendZoneStroke = (
  state: ZonesGameState,
  x: number,
  y: number,
): void => {
  if (!state.isDragging || state.dragButton === null) return;
  const key = `${x},${y}`;
  if (state.dragButton === "left") state.pendingAdd.add(key);
  else state.pendingRemove.add(key);
};

export const endZoneStroke = async (
  state: ZonesGameState,
  zoneId: number,
): Promise<void> => {
  state.isDragging = false;
  state.dragButton = null;
  const add = [...state.pendingAdd].map((k) => k.split(",").map(Number) as [number, number]);
  const remove = [...state.pendingRemove].map((k) => k.split(",").map(Number) as [number, number]);
  state.pendingAdd.clear();
  state.pendingRemove.clear();
  if (add.length === 0 && remove.length === 0) return;
  await fetch(`/api/zones/${zoneId}/cells`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ add, remove }),
  });
  // Server will broadcast ZONES_UPDATED → refetchZones in network.ts will update.
};
```

- [ ] **Step 2: Wire mouse events in `index.ts`**

In `packages/burger-client/src/game/index.ts`, find the existing canvas mousedown/mousemove/mouseup handlers (used for tile-paint). Add a parallel branch for zone-paint:

Before the existing tile-paint mousedown body, add an early return for zone mode:

```ts
if (zones.active) {
  if (zones.selectedZoneId === null) return;
  const button = e.button === 2 ? "right" : "left";
  beginZoneStroke(zones, button);
  const { x, y } = canvasToCellCenter(e);  // use the existing helper
  extendZoneStroke(zones, x, y);
  return;
}
```

For mousemove:

```ts
if (zones.active && zones.isDragging) {
  const { x, y } = canvasToCellCenter(e);
  extendZoneStroke(zones, x, y);
  return;
}
```

For mouseup:

```ts
if (zones.active && zones.isDragging) {
  if (zones.selectedZoneId !== null) endZoneStroke(zones, zones.selectedZoneId);
  return;
}
```

If a `canvasToCellCenter`-style helper doesn't exist, follow the math the existing tile-paint code uses (it converts mouse coords through `app.screen.width/height`, camera, zoom — search for `worldX` and `worldY` in editor.ts; the same conversion applies here).

- [ ] **Step 3: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Manual smoke**

```bash
pnpm dev
```

Log in as admin. Create a zone via curl:

```bash
curl -X POST -H "Content-Type: application/json" --cookie "burger_session=<sess>" -d '{"name":"test"}' http://localhost:5000/api/zones
```

In browser console:

```js
useStore.getState().setSelectedZone(<id>)
```

Press `z`, click on the canvas. Confirm cells appear colored. Press `z` again, confirm overlay disappears.

Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-client/src/game/zones.ts packages/burger-client/src/game/index.ts
git commit -m "feat(client): zone-paint mouse handlers + cell stroke PUT"
```

---

## Task 12: Zones admin window UI

**Files:**
- Create: `packages/burger-client/src/windows/ZonesWindow.tsx`
- Modify: `packages/burger-client/src/windows/WindowManager.tsx` (window id + registration + taskbar)

- [ ] **Step 1: Add `WINDOW_ZONES` constant**

In `packages/burger-client/src/windows/WindowManager.tsx`, alongside the existing `WINDOW_ATLAS` and `WINDOW_SPAWN` constants (currently lines ~13-14), add:

```ts
export const WINDOW_ZONES = "zones";
```

Also extend the registerWindow block (around line 40-48) with:

```ts
      registerWindow(WINDOW_ZONES, {
        title: "Zones",
        defaultPos: { x: 20, y: 60 },
      });
```

(Match the exact signature of the existing `registerWindow` calls.)

And extend `taskbarIds` (line 104):

```ts
const taskbarIds = isAdmin ? [WINDOW_ATLAS, WINDOW_SPAWN, WINDOW_BOTS, WINDOW_ZONES] : [];
```

- [ ] **Step 2: Create `ZonesWindow.tsx`**

Create `packages/burger-client/src/windows/ZonesWindow.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Window } from "./Window";
import { useStore, refetchZones } from "../store";
import { WINDOW_ZONES } from "./WindowManager";

type UserOption = { id: string; display_name: string | null };

export const ZonesWindow = () => {
  const list = useStore((s) => s.zones.list);
  const selectedId = useStore((s) => s.zones.selectedId);
  const setSelectedZone = useStore((s) => s.setSelectedZone);
  const [newName, setNewName] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);

  const selected = list.find((z) => z.id === selectedId);

  useEffect(() => {
    refetchZones();
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users));
  }, []);

  const createZone = async () => {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewName("");
      await refetchZones();
      setSelectedZone(data.id);
    } else if (res.status === 409) {
      alert("name already taken");
    }
  };

  const renameZone = async (id: number, name: string) => {
    await fetch(`/api/zones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  const deleteZone = async (id: number) => {
    if (!confirm(`Delete zone "${selected?.name}"?`)) return;
    await fetch(`/api/zones/${id}`, { method: "DELETE" });
    setSelectedZone(null);
  };

  const toggleMember = async (userId: string) => {
    if (!selected) return;
    const current = new Set(selected.member_user_ids);
    if (current.has(userId)) current.delete(userId);
    else current.add(userId);
    await fetch(`/api/zones/${selected.id}/members`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: [...current] }),
    });
  };

  return (
    <Window id={WINDOW_ZONES} title="Zones" initialPos={{ x: 20, y: 60 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px" }}>
        <div>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="new zone name"
          />
          <button onClick={createZone}>+ New</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {list.map((z) => (
            <div
              key={z.id}
              onClick={() => setSelectedZone(z.id)}
              style={{
                padding: "4px",
                cursor: "pointer",
                background: z.id === selectedId ? "#ddd" : "transparent",
              }}
            >
              {z.name} ({z.cell_count} cells, {z.member_user_ids.length} members)
            </div>
          ))}
        </div>
        {selected && (
          <div style={{ borderTop: "1px solid #ccc", paddingTop: "8px" }}>
            <input
              defaultValue={selected.name}
              onBlur={(e) => renameZone(selected.id, e.currentTarget.value)}
            />
            <div style={{ marginTop: "4px" }}>
              <strong>Members:</strong>
              {users.map((u) => (
                <label key={u.id} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={selected.member_user_ids.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                  />
                  {u.display_name ?? u.id}
                </label>
              ))}
            </div>
            <button onClick={() => deleteZone(selected.id)} style={{ marginTop: "8px" }}>
              Delete zone
            </button>
          </div>
        )}
      </div>
    </Window>
  );
};
```

(Style is minimal/inline. Match existing window styling if your codebase has a CSS module pattern.)

- [ ] **Step 3: Render the window**

In `packages/burger-client/src/windows/WindowManager.tsx`, import `ZonesWindow` and add it to the rendered output alongside the other windows:

```tsx
import { ZonesWindow } from "./ZonesWindow";
```

In the JSX where existing windows render (search for `<AtlasWindow`, `<SpawnWindow`, `<BotsWindow`), add:

```tsx
{windows[WINDOW_ZONES]?.open && <ZonesWindow />}
```

Use the exact conditional pattern from the existing windows (some may use `getWindow` selectors, etc.). The taskbar button is auto-rendered by virtue of `WINDOW_ZONES` being in the `taskbarIds` array from Step 1.

- [ ] **Step 4: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Manual smoke**

```bash
pnpm dev
```

Log in as admin. Click "Zones" in taskbar. Create a zone. Select it. Press `z` and click on the canvas — cells should appear. Press `z` again to exit.

Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-client/src/windows/ZonesWindow.tsx packages/burger-client/src/windows/WindowManager.tsx
git commit -m "feat(client): Zones admin window with create/rename/delete + member multi-select"
```

---

## Final Verification

After Task 12, run the full verification pipeline:

```bash
pnpm --filter burger-server test 2>&1 | tail -8 && \
pnpm --filter burger-shared test 2>&1 | tail -8 && \
pnpm lint 2>&1 | tail -3 && \
pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && \
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -3 && \
pnpm fmt:check 2>&1 | tail -3 && \
pnpm --filter burger-client build 2>&1 | tail -5
```

Expected: all tests pass, 0 lint warnings, 0 type errors, fmt clean, build succeeds.

End-to-end manual smoke (already done at each step, repeat once more):

1. `pnpm dev`. Log in as admin in browser A, non-admin in browser B.
2. In admin: open Zones window, create "alice-zone", paint a few cells via `z`+click, assign Alice in member checkboxes.
3. In non-admin (Alice): no UI changes are expected yet (spec doesn't ship non-admin paint UI), but devtools network/WS tab should show `MY_ZONES` arriving.
4. From non-admin browser console, manually send a paint message inside one of Alice's cells (`ws.send(JSON.stringify({ type: "paint", x: 16, y: 16, tileId: 3 }))`). Confirm a tile appears in the world for both players.
5. From non-admin browser console, paint outside the zone. Confirm no tile appears.
6. Kill dev server.



