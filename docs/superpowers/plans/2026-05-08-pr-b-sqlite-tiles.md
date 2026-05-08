# PR B — SQLite tile store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace LDtk with a SQLite-backed tile store. Add `atlas.toml` as the catalog source of truth, add world bounds (hard wall), bump protocol to v2 to deliver bounds to clients, write the LDtk → SQLite import script, delete `level.ts` and `burger.json`.

**Architecture:** New `world.ts` boots the world from SQLite. Catalog rows are upserted from `atlas.toml` on every server boot. `SharedWorld` gains a `bounds` field; `moveAndSlide` clamps player position. The YOUR_EID payload is extended to carry world bounds. LDtk is gone after the import.

**Tech Stack:** Bun, `bun:sqlite`, native TOML imports (Bun supports `import "./foo.toml"`).

**Spec:** `docs/superpowers/specs/2026-05-08-pr-b-sqlite-tiles-design.md`
**Branch:** `editor-and-auth` (already checked out)
**Depends on:** PR A merged (db.ts, sessions, auth gating).

---

## File structure

| Path                                            | Responsibility                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/burger-server/atlas.toml`             | Tile catalog source of truth (committed)                                |
| `packages/burger-server/src/world.ts`           | Init world from SQLite: catalog sync, tile load, settings, ECS entities |
| `packages/burger-server/scripts/import-ldtk.ts` | One-time import LDtk → SQLite                                           |
| `packages/burger-server/test/world.test.ts`     | Unit tests for catalog sync + tile load + settings + bounds             |
| `packages/burger-shared/test/collision.test.ts` | Add bounds-clamp tests (modify existing file)                           |

Modified:

- `packages/burger-server/src/db.ts` — add tile_catalog, tiles, tile_edits, settings tables
- `packages/burger-shared/src/world.shared.ts` — `SharedWorld.bounds` field
- `packages/burger-shared/src/collision.ts` — clamp final position to bounds
- `packages/burger-shared/src/const.shared.ts` — bump `PROTOCOL_VERSION` to 2
- `packages/burger-server/src/network.server.ts` — send bounds in YOUR_EID
- `packages/burger-client/src/network.client.ts` — receive bounds in YOUR_EID
- `packages/burger-server/src/players.ts` — random spawn from spawnZone
- `packages/burger-server/src/server.ts` — replace `createLevel` call with `initWorld(db)`

Deleted:

- `packages/burger-server/src/level.ts`
- `packages/burger-server/src/burger.json`

---

## Task 1: Schema additions

**Files:**

- Modify: `packages/burger-server/src/db.ts`
- Modify: `packages/burger-server/test/auth/db.test.ts` (add new table assertions)

- [ ] **Step 1: Add new tables to runMigrations**

Append to the existing `runMigrations` body (after the sessions table):

```ts
db.run(`
  CREATE TABLE IF NOT EXISTS tile_catalog (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    src_x INTEGER NOT NULL,
    src_y INTEGER NOT NULL,
    label TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS tiles (
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    tile_id INTEGER NOT NULL REFERENCES tile_catalog(id),
    PRIMARY KEY (x, y)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS tile_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    old_tile_id INTEGER,
    new_tile_id INTEGER,
    user_id TEXT REFERENCES users(id),
    edited_at INTEGER NOT NULL
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS tile_edits_pos ON tile_edits(x, y)`);
db.run(`CREATE INDEX IF NOT EXISTS tile_edits_time ON tile_edits(edited_at)`);

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
```

- [ ] **Step 2: Add tests for new tables**

Append to `packages/burger-server/test/auth/db.test.ts`:

```ts
test("runMigrations creates tile_catalog, tiles, tile_edits, settings tables", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const names = (
    db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
  expect(names).toContain("tile_catalog");
  expect(names).toContain("tiles");
  expect(names).toContain("tile_edits");
  expect(names).toContain("settings");
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter burger-server test test/auth/db.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/burger-server/src/db.ts packages/burger-server/test/auth/db.test.ts
git commit -m "chore: add tile_catalog, tiles, tile_edits, settings tables"
```

---

## Task 2: SharedWorld bounds + moveAndSlide clamp

**Files:**

- Modify: `packages/burger-shared/src/world.shared.ts`
- Modify: `packages/burger-shared/src/collision.ts`
- Modify: `packages/burger-shared/test/collision.test.ts`

- [ ] **Step 1: Add bounds to SharedWorld type**

Edit `packages/burger-shared/src/world.shared.ts`:

```ts
import { createWorld } from "bitecs";
import { sharedComponents } from "./ecs.shared";

const sharedWorldDefaults = () => ({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: Date.now() },
  bounds: { x: 0, y: 0, w: 0, h: 0 },
});

export const createSharedWorld = <Extra extends object>(extra: Extra) =>
  createWorld({ ...sharedWorldDefaults(), ...extra });

export type SharedWorld = {
  components: typeof sharedComponents;
  time: { delta: number; elapsed: number; then: number };
  bounds: { x: number; y: number; w: number; h: number };
};
```

- [ ] **Step 2: Add bounds clamp to moveAndSlide**

Edit `packages/burger-shared/src/collision.ts`. After the existing collision resolution but before the return, add:

```ts
// At the very end of moveAndSlide, replace the existing `return { x: newX, y: newY };` with:

const halfPlayer = PLAYER_SIZE / 2;
const minX = world.bounds.x + halfPlayer;
const maxX = world.bounds.x + world.bounds.w - halfPlayer;
const minY = world.bounds.y + halfPlayer;
const maxY = world.bounds.y + world.bounds.h - halfPlayer;

const clampedX =
  world.bounds.w > 0 ? Math.max(minX, Math.min(maxX, newX)) : newX;
const clampedY =
  world.bounds.h > 0 ? Math.max(minY, Math.min(maxY, newY)) : newY;

return { x: clampedX, y: clampedY };
```

The `world.bounds.w > 0` guard means tests/legacy callers that didn't set bounds keep working as a degenerate "no clamp" mode.

- [ ] **Step 3: Add bounds test cases**

Append to `packages/burger-shared/test/collision.test.ts`:

```ts
test("moveAndSlide clamps player to right boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  // Player near the right edge with rightward velocity.
  const out = moveAndSlide(world, 300, 100, 1, 0, 100);
  expect(out.x).toBeLessThanOrEqual(320 - PLAYER_SIZE / 2);
});

test("moveAndSlide clamps player to left boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 5, 100, -1, 0, 100);
  expect(out.x).toBeGreaterThanOrEqual(PLAYER_SIZE / 2);
});

test("moveAndSlide clamps player to top boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 100, 5, 0, -1, 100);
  expect(out.y).toBeGreaterThanOrEqual(PLAYER_SIZE / 2);
});

test("moveAndSlide clamps player to bottom boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 100, 300, 0, 1, 100);
  expect(out.y).toBeLessThanOrEqual(320 - PLAYER_SIZE / 2);
});

test("moveAndSlide with zero bounds applies no clamp (degenerate)", () => {
  const world = createSharedWorld({});
  // Default bounds are 0,0,0,0 — clamp is a no-op.
  const out = moveAndSlide(world, 1000, 1000, 1, 1, 100);
  expect(out.x).toBe(1100);
  expect(out.y).toBe(1100);
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter burger-shared test
pnpm --filter burger-shared exec tsc --noEmit
```

Expected: all collision tests pass, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-shared/src/world.shared.ts \
        packages/burger-shared/src/collision.ts \
        packages/burger-shared/test/collision.test.ts
git commit -m "feat: world bounds in SharedWorld and moveAndSlide"
```

---

## Task 3: PROTOCOL_VERSION bump + bounds in YOUR_EID

**Files:**

- Modify: `packages/burger-shared/src/const.shared.ts`
- Modify: `packages/burger-server/src/network.server.ts`
- Modify: `packages/burger-client/src/network.client.ts`
- Modify: `packages/burger-server/test/e2e.test.ts` (PROTOCOL_VERSION + bounds in YOUR_EID payload)

- [ ] **Step 1: Bump PROTOCOL_VERSION to 2**

Edit `packages/burger-shared/src/const.shared.ts`:

```ts
export const PROTOCOL_VERSION = 2;
```

- [ ] **Step 2: Send bounds in YOUR_EID on the server**

Edit the WS open handler in `packages/burger-server/src/network.server.ts`. Replace the existing YOUR_EID send with:

```ts
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
```

- [ ] **Step 3: Receive bounds on the client**

Edit `packages/burger-client/src/network.client.ts`. The YOUR_EID handler currently parses `[version, eid]` (2 ints). Update to parse 6 ints:

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
  me.serverEid = view[1]!;
  world.bounds = {
    x: view[2]!,
    y: view[3]!,
    w: view[4]!,
    h: view[5]!,
  };
  break;
}
```

The `world` reference in the YOUR_EID handler comes from `setupSocket`'s `world` parameter. The handler is inside `setupSocket`'s `socket.addEventListener("message", ...)` closure; `world` is in scope.

- [ ] **Step 4: Update e2e test for bounds in YOUR_EID**

Edit `packages/burger-server/test/e2e.test.ts`. The "server sends YOUR_EID with correct protocol version" test:

```ts
test("server sends YOUR_EID with correct protocol version and bounds", async () => {
  // ...existing setup...
  const view = new Int32Array(yourEid!.slice(1).buffer);
  expect(view[0]).toBe(PROTOCOL_VERSION);
  expect(view[1]).toBeGreaterThan(0);
  expect(view.length).toBe(6); // version, eid, bounds(4)
});
```

(The test creates a world with `bounds: { x: 0, y: 0, w: 0, h: 0 }` by default; the values are zero but that's fine — the test only verifies the payload shape.)

In the test setup, give the world bounds for these tests so other physics-based tests don't accidentally fail:

```ts
world.bounds = { x: 0, y: 0, w: 64 * TILE_SIZE, h: 64 * TILE_SIZE };
```

(`TILE_SIZE` is imported from burger-shared.)

- [ ] **Step 5: Run tests**

```bash
pnpm test
pnpm --filter burger-client exec tsc --noEmit
pnpm --filter burger-client build
```

Expected: all pass, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-shared/src/const.shared.ts \
        packages/burger-server/src/network.server.ts \
        packages/burger-client/src/network.client.ts \
        packages/burger-server/test/e2e.test.ts
git commit -m "feat: protocol v2 sends bounds in YOUR_EID"
```

---

## Task 4: atlas.toml + world.ts (catalog sync, settings, tile load)

**Files:**

- Create: `packages/burger-server/atlas.toml`
- Create: `packages/burger-server/src/world.ts`
- Create: `packages/burger-server/test/world.test.ts`

- [ ] **Step 1: Create atlas.toml**

```toml
# packages/burger-server/atlas.toml
# Tile catalog. Source of truth for what can be painted.
# id is stable forever — never reuse an id, even if you delete a tile.
# type is one of: floor, wall, counter.

[[tiles]]
id = 1
type = "floor"
src_x = 0
src_y = 0
label = "floor"

[[tiles]]
id = 2
type = "wall"
src_x = 32
src_y = 0
label = "wall"

[[tiles]]
id = 3
type = "counter"
src_x = 64
src_y = 0
label = "counter"
```

(Note: actual src_x/src_y values must match what's in the existing atlas.png. After Task 6's import, the maintainer reviews this file and reconciles any tiles the LDtk export had that aren't here.)

- [ ] **Step 2: Write failing tests for world.ts**

```ts
// packages/burger-server/test/world.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db";
import {
  syncCatalog,
  seedDefaultSettings,
  readSettings,
  loadCatalog,
  loadTilesIntoEcs,
  initWorld,
} from "../src/world";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
};

test("syncCatalog inserts catalog rows from TOML data", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
  const rows = db
    .query("SELECT * FROM tile_catalog ORDER BY id")
    .all() as any[];
  expect(rows).toEqual([
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
});

test("syncCatalog updates existing rows", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
  ]);
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "renamed" },
  ]);
  const row = db
    .query("SELECT label FROM tile_catalog WHERE id = 1")
    .get() as any;
  expect(row.label).toBe("renamed");
});

test("syncCatalog leaves unrelated rows in place (warning only)", () => {
  const db = setupDb();
  // Pre-existing row not in the toml input.
  db.run(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?)",
    [99, "wall", 0, 0, "legacy"],
  );
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
  ]);
  const row = db.query("SELECT * FROM tile_catalog WHERE id = 99").get();
  expect(row).not.toBeNull();
});

test("seedDefaultSettings inserts defaults when missing", () => {
  const db = setupDb();
  seedDefaultSettings(db);
  const settings = readSettings(db);
  expect(settings.spawn_x).toBe("0");
  expect(settings.world_width).toBe(String(64 * 32));
});

test("seedDefaultSettings preserves existing values", () => {
  const db = setupDb();
  db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [
    "world_width",
    "999",
  ]);
  seedDefaultSettings(db);
  const settings = readSettings(db);
  expect(settings.world_width).toBe("999");
});

test("loadCatalog returns rows joined into a Map by id", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "f" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "w" },
  ]);
  const cat = loadCatalog(db);
  expect(cat.get(1)?.type).toBe("floor");
  expect(cat.get(2)?.type).toBe("wall");
  expect(cat.size).toBe(2);
});

test("initWorld creates ECS entities for tiles in DB", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "f" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "w" },
  ]);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (32, 64, 2)");
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (96, 64, 1)");
  seedDefaultSettings(db);

  const world = initWorld(db);
  // Expect 2 tile entities, the wall is solid.
  const { Position, Tile, Solid } = world.components;
  const { query } = require("bitecs");
  const tiles = query(world, [Position, Tile]);
  expect(tiles.length).toBe(2);

  const solid = query(world, [Position, Solid]);
  expect(solid.length).toBe(1);

  // tilesAtPosition index populated
  expect(world.tilesAtPosition.has("32,64")).toBe(true);
  expect(world.tilesAtPosition.has("96,64")).toBe(true);
});

test("initWorld populates spawnZone and bounds from settings", () => {
  const db = setupDb();
  syncCatalog(db, [{ id: 1, type: "floor", src_x: 0, src_y: 0, label: "f" }]);
  seedDefaultSettings(db);
  const world = initWorld(db);
  expect(world.bounds.w).toBe(64 * 32);
  expect(world.bounds.h).toBe(64 * 32);
  expect(world.spawnZone.x).toBe(0);
  expect(world.spawnZone.y).toBe(0);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter burger-server test test/world.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement world.ts**

```ts
// packages/burger-server/src/world.ts
import { addComponent, addEntity } from "bitecs";
import type { Database } from "bun:sqlite";
import { createSharedWorld, TILE_SIZE } from "burger-shared";
import atlas from "../atlas.toml";

export type CatalogEntry = {
  id: number;
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};

export type WorldExtras = {
  catalog: Map<number, CatalogEntry>;
  catalogIds: Set<number>;
  tilesAtPosition: Map<string, number>;
  spawnZone: { x: number; y: number; w: number; h: number };
  typeIdToAtlasSrc: Record<number, [number, number]>;
};

const DEFAULT_SETTINGS: Record<string, string> = {
  spawn_x: "0",
  spawn_y: "0",
  spawn_w: String(TILE_SIZE * 4),
  spawn_h: String(TILE_SIZE * 4),
  world_width: String(TILE_SIZE * 64),
  world_height: String(TILE_SIZE * 64),
};

export const syncCatalog = (db: Database, tiles: CatalogEntry[]): void => {
  const stmt = db.prepare(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, src_x = excluded.src_x, src_y = excluded.src_y, label = excluded.label",
  );
  const tomlIds = new Set(tiles.map((t) => t.id));
  const dbRows = db.query("SELECT id FROM tile_catalog").all() as {
    id: number;
  }[];
  for (const row of dbRows) {
    if (!tomlIds.has(row.id)) {
      console.warn(
        `tile_catalog row ${row.id} is in DB but not in atlas.toml; leaving in place`,
      );
    }
  }
  for (const t of tiles) {
    stmt.run(t.id, t.type, t.src_x, t.src_y, t.label);
  }
};

export const seedDefaultSettings = (db: Database): void => {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    stmt.run(k, v);
  }
};

export const readSettings = (db: Database): Record<string, string> => {
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

export const loadCatalog = (db: Database): Map<number, CatalogEntry> => {
  const rows = db
    .query("SELECT id, type, src_x, src_y, label FROM tile_catalog")
    .all() as CatalogEntry[];
  return new Map(rows.map((r) => [r.id, r]));
};

export const loadTilesIntoEcs = (
  world: ReturnType<typeof createSharedWorld<WorldExtras>>,
  db: Database,
): void => {
  const { Position, Tile, Networked, Solid } = world.components;
  const rows = db.query("SELECT x, y, tile_id FROM tiles").all() as {
    x: number;
    y: number;
    tile_id: number;
  }[];

  for (const row of rows) {
    const cat = world.catalog.get(row.tile_id);
    if (!cat) {
      console.warn(
        `tile at (${row.x},${row.y}) references missing catalog id ${row.tile_id}; skipping`,
      );
      continue;
    }

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    Position.x[eid] = row.x;
    Position.y[eid] = row.y;

    addComponent(world, eid, Tile);
    Tile.type[eid] = row.tile_id;

    if (cat.type === "wall" || cat.type === "counter") {
      addComponent(world, eid, Solid);
    }

    addComponent(world, eid, Networked);

    world.tilesAtPosition.set(`${row.x},${row.y}`, eid);
    world.typeIdToAtlasSrc[row.tile_id] = [cat.src_x, cat.src_y];
  }
};

const tomlTiles = (atlas as { tiles: CatalogEntry[] }).tiles;

export const initWorld = (db: Database) => {
  syncCatalog(db, tomlTiles);
  seedDefaultSettings(db);

  const settings = readSettings(db);
  const catalog = loadCatalog(db);

  const spawnZone = {
    x: parseInt(settings.spawn_x ?? "0", 10),
    y: parseInt(settings.spawn_y ?? "0", 10),
    w: parseInt(settings.spawn_w ?? String(TILE_SIZE * 4), 10),
    h: parseInt(settings.spawn_h ?? String(TILE_SIZE * 4), 10),
  };

  const world = createSharedWorld<WorldExtras>({
    catalog,
    catalogIds: new Set(catalog.keys()),
    tilesAtPosition: new Map<string, number>(),
    spawnZone,
    typeIdToAtlasSrc: {} as Record<number, [number, number]>,
  });

  world.bounds = {
    x: 0,
    y: 0,
    w: parseInt(settings.world_width ?? String(TILE_SIZE * 64), 10),
    h: parseInt(settings.world_height ?? String(TILE_SIZE * 64), 10),
  };

  // Populate typeIdToAtlasSrc from catalog so the existing /api/atlas endpoint works.
  for (const [id, entry] of catalog) {
    world.typeIdToAtlasSrc[id] = [entry.src_x, entry.src_y];
  }

  loadTilesIntoEcs(world, db);

  return world;
};

export type World = ReturnType<typeof initWorld>;
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter burger-server test test/world.test.ts`
Expected: 8/8 pass.

If TOML import doesn't work in Bun tests (e.g. `atlas.toml` resolution at test runtime), use `Bun.file("./atlas.toml").text()` synchronously in `initWorld` instead of the static import:

```ts
import TOML from "smol-toml"; // OR: avoid this dep — see below
```

Actually, prefer Bun's native TOML support: `import atlas from "../atlas.toml"`. If that fails in tests because the path is relative to the source file location, switch to a runtime resolve via `Bun.file`. Verify in implementation.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-server/atlas.toml \
        packages/burger-server/src/world.ts \
        packages/burger-server/test/world.test.ts
git commit -m "feat: add atlas.toml catalog and world.ts loader"
```

---

## Task 5: Wire world.ts into server.ts; remove level.ts

**Files:**

- Modify: `packages/burger-server/src/server.ts`
- Modify: `packages/burger-server/src/players.ts`
- Delete: `packages/burger-server/src/level.ts`

- [ ] **Step 1: Replace createLevel with initWorld in server.ts**

Edit `packages/burger-server/src/server.ts`. Replace:

```ts
import { createLevel } from "./level";
// ...
const world = createWorld({...});
// ...
createLevel(world);
```

With:

```ts
import { initWorld } from "./world";
// ...
const db = openDatabase();
const authConfig = loadAuthConfig();
const world = initWorld(db);
```

The `World` export type comes from `world.ts` now:

```ts
export type { World } from "./world";
```

Remove `world.playerSpawns` initialization (it's gone). Remove the spawn lookup in `createServer`'s arguments.

- [ ] **Step 2: Update players.ts to use spawnZone**

Edit `packages/burger-server/src/players.ts`:

```ts
import { addComponent, addEntity } from "bitecs";
import type { World } from "./server";
import invariant from "tiny-invariant";

export const createPlayer = (world: World, name: string): number => {
  const { Player, Position, Velocity, Networked } = world.components;
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  Player.name[eid] = name;

  const { spawnZone } = world;
  invariant(spawnZone);
  const x = spawnZone.x + Math.random() * spawnZone.w;
  const y = spawnZone.y + Math.random() * spawnZone.h;

  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;

  addComponent(world, eid, Velocity);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;

  addComponent(world, eid, Networked);

  return eid;
};
```

- [ ] **Step 3: Update e2e tests to use initWorld + DB**

Edit `packages/burger-server/test/e2e.test.ts`. Replace the `createSharedWorld` calls in `beforeEach` with `initWorld(db)`. Make sure the test DB has at least the catalog seeded (for which the world.ts toml import handles automatically; test just needs to call `initWorld`).

```ts
import { initWorld } from "../src/world";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  // Seed test user
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["u1", "fid1", "TestUser", "Test User", 0, Date.now()],
  );
  sessionId = "test-session-id";
  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    sessionId,
    "u1",
    Date.now() + 1_000_000,
  ]);

  world = initWorld(db);

  port = 5500 + Math.floor(Math.random() * 500);
  app = createServer({
    port,
    world,
    db,
    authConfig: {
      fourmUrl: "x",
      burgerUrl: "x",
      clientId: "burger",
      isProduction: false,
    },
    onPlayerJoin: (name) => createPlayer(world, name),
    onPlayerLeave: (eid) => removeEntity(world, eid),
  });
});
```

- [ ] **Step 4: Delete level.ts**

```bash
rm packages/burger-server/src/level.ts
```

(Don't delete `burger.json` yet — Task 6's import script needs it.)

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm test
pnpm --filter burger-server exec tsc --noEmit
pnpm --filter burger-client exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Smoke-test server starts**

```bash
timeout 5 pnpm dev:server || true
```

Expected: prints "Server running on localhost:5000".

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire world.ts into server, remove level.ts"
```

---

## Task 6: LDtk import script

**Files:**

- Create: `packages/burger-server/scripts/import-ldtk.ts`

- [ ] **Step 1: Write the import script**

```ts
// packages/burger-server/scripts/import-ldtk.ts
/**
 * One-time LDtk → SQLite import.
 *
 * Reads packages/burger-server/src/burger.json, the existing LDtk export.
 * Populates tile_catalog from the LDtk customData (tileId → type).
 * Populates tiles from gridTiles.
 * Sets spawn_x/spawn_y from the first PlayerSpawn entity.
 *
 * Usage:
 *   pnpm --filter burger-server exec bun scripts/import-ldtk.ts
 *
 * Idempotent. Re-running overwrites existing tiles to match the LDtk source.
 * Does NOT delete tiles that aren't in the LDtk export.
 */
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db";
import burgerLevel from "../src/burger.json";

const TYPE_MAP: Record<string, string> = {
  floor: "floor",
  wall: "wall",
  counter: "counter",
};

const dbPath = process.env.DB_PATH ?? "./data/burger.db";
console.log(`importing into ${dbPath}`);
const db = new Database(dbPath);
runMigrations(db);

// Step 1: Build tileId → type map from LDtk customData
const tilesets = burgerLevel.defs.tilesets[0];
if (!tilesets) throw new Error("no tilesets in burger.json");

const tileIdToType: Record<number, string> = {};
for (const { tileId, data } of tilesets.customData) {
  const parsed = JSON.parse(data);
  const type = TYPE_MAP[String(parsed).toLowerCase()];
  if (!type) {
    console.warn(`tile ${tileId} has unknown type "${parsed}"; skipping`);
    continue;
  }
  tileIdToType[tileId] = type;
}

// Step 2: Build catalog from unique (src_x, src_y, type) tuples found in gridTiles
const level = burgerLevel.levels[0];
if (!level) throw new Error("no level in burger.json");
const layerTiles = level.layerInstances[1];
if (!layerTiles) throw new Error("no tile layer (index 1)");

const catalogByKey = new Map<
  string,
  { type: string; src_x: number; src_y: number; label: string }
>();
for (const { t, src } of layerTiles.gridTiles) {
  const type = tileIdToType[t];
  if (!type) continue;
  const key = `${type}-${src[0]}-${src[1]}`;
  if (!catalogByKey.has(key)) {
    catalogByKey.set(key, {
      type,
      src_x: src[0]!,
      src_y: src[1]!,
      label: `${type} ${src[0]},${src[1]}`,
    });
  }
}

// Assign stable catalog IDs starting from 1.
let nextId = 1;
const insertCatStmt = db.prepare(
  "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, src_x = excluded.src_x, src_y = excluded.src_y, label = excluded.label",
);
const catalogKeyToId = new Map<string, number>();

// Reuse existing catalog rows by (type, src_x, src_y) match.
const existing = db
  .query("SELECT id, type, src_x, src_y FROM tile_catalog")
  .all() as { id: number; type: string; src_x: number; src_y: number }[];
for (const row of existing) {
  const key = `${row.type}-${row.src_x}-${row.src_y}`;
  catalogKeyToId.set(key, row.id);
  if (row.id >= nextId) nextId = row.id + 1;
}

for (const [key, entry] of catalogByKey) {
  if (!catalogKeyToId.has(key)) {
    const id = nextId++;
    insertCatStmt.run(id, entry.type, entry.src_x, entry.src_y, entry.label);
    catalogKeyToId.set(key, id);
  }
}

console.log(`catalog populated: ${catalogKeyToId.size} entries`);

// Step 3: Insert tiles
const insertTileStmt = db.prepare(
  "INSERT INTO tiles (x, y, tile_id) VALUES (?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET tile_id = excluded.tile_id",
);
const insertEditStmt = db.prepare(
  "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (?, ?, ?, ?, ?, ?)",
);
let tileCount = 0;
const now = Date.now();
for (const { t, px, src } of layerTiles.gridTiles) {
  const type = tileIdToType[t];
  if (!type) continue;
  const key = `${type}-${src[0]}-${src[1]}`;
  const catId = catalogKeyToId.get(key);
  if (!catId) continue;
  const x = px[0]!;
  const y = px[1]!;

  // Capture old value for the edit log.
  const old = db
    .query("SELECT tile_id FROM tiles WHERE x = ? AND y = ?")
    .get(x, y) as { tile_id: number } | undefined;
  insertTileStmt.run(x, y, catId);
  insertEditStmt.run(x, y, old?.tile_id ?? null, catId, null, now);
  tileCount++;
}
console.log(`tiles imported: ${tileCount}`);

// Step 4: Spawn from first PlayerSpawn entity
const entities = level.layerInstances[0];
if (entities) {
  for (const entity of entities.entityInstances) {
    if (entity.__identifier === "PlayerSpawn") {
      db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ["spawn_x", String(entity.__worldX)],
      );
      db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ["spawn_y", String(entity.__worldY)],
      );
      console.log(`spawn set to (${entity.__worldX}, ${entity.__worldY})`);
      break;
    }
  }
}

console.log("import done");
db.close();
```

- [ ] **Step 2: Run the import (manual step for the maintainer; the agent doing this PR runs it locally if burger.json is present)**

If `packages/burger-server/src/burger.json` exists locally, run:

```bash
DB_PATH=./data/burger.db pnpm --filter burger-server exec bun scripts/import-ldtk.ts
```

Expected output: catalog populated, tiles imported, spawn set.

If `burger.json` is NOT present (already deleted, or fresh checkout), skip the manual run for this Task; the maintainer runs it before deployment.

- [ ] **Step 3: After successful import, sync atlas.toml**

The import script auto-generated catalog rows. Read them and update `packages/burger-server/atlas.toml` so the seed matches the imported state going forward:

```bash
sqlite3 ./data/burger.db "SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id"
```

Manually transcribe each row into atlas.toml in the `[[tiles]]` format. (This is fine because the catalog IDs are now stable.)

If transcribing manually is tedious, you can write a tiny export script — but for one-off use, the manual approach is fine.

- [ ] **Step 4: Verify post-import server starts and serves the world**

```bash
DB_PATH=./data/burger.db timeout 5 pnpm dev:server || true
```

Expected: server starts, log shows tiles loaded.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-server/scripts/import-ldtk.ts packages/burger-server/atlas.toml
git commit -m "chore: add ldtk import script and seed atlas.toml"
```

---

## Task 7: Delete burger.json and final verification

**Files:**

- Delete: `packages/burger-server/src/burger.json`

- [ ] **Step 1: Delete burger.json**

```bash
rm packages/burger-server/src/burger.json
```

(It's gitignored, so this only affects the local checkout. Maintainers' local copies are unchanged.)

- [ ] **Step 2: Run all tests and typecheck**

```bash
pnpm test
pnpm --filter burger-shared exec tsc --noEmit
pnpm --filter burger-server exec tsc --noEmit
pnpm --filter burger-client exec tsc --noEmit
```

Expected: all green.

- [ ] **Step 3: Run client build**

```bash
pnpm --filter burger-client build
```

Expected: clean.

- [ ] **Step 4: Smoke-test pnpm dev**

```bash
timeout 5 pnpm dev:server || true
```

Expected: prints "Server running on localhost:5000" with tiles loaded count.

- [ ] **Step 5: Update README**

Add a short section after the existing Auth section:

````markdown
## World data

Tiles are stored in the SQLite database at `DB_PATH` (default `./data/burger.db`).
The tile catalog (paintable tile types) is committed in `packages/burger-server/atlas.toml`.

To bootstrap a world from an LDtk export:

```bash
DB_PATH=./data/burger.db pnpm --filter burger-server exec bun scripts/import-ldtk.ts
```
````

Requires `packages/burger-server/src/burger.json` (gitignored) to be present.

````

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete burger.json and document tile store in README"
````

---

## Final verification

- [ ] All 7 tasks committed.
- [ ] `pnpm test` passes.
- [ ] `pnpm --filter burger-client build` clean.
- [ ] Server starts after import; clients connect and see the imported world.
- [ ] World bounds clamp prevents walking past the world edge.
- [ ] PROTOCOL_VERSION = 2; old clients (v1) get the version mismatch and disconnect cleanly.
