# PR B — SQLite tile store

Status: approved
Part of: [`2026-05-08-editor-and-auth-overview.md`](./2026-05-08-editor-and-auth-overview.md)
Depends on: PR A (the SQLite database, `db.ts`, `data/` volume).

## Goal

Replace the LDtk-based level loader with a SQLite-backed tile store. Introduce `atlas.toml` as the canonical tile catalog. Add world bounds (a hard wall around the playable area). After this PR, the world persists in `burger.db` and can be modified by direct SQL (the editor UI comes in PR C).

## Non-goals (this PR)

- Editor UI, paint message, palette (PR C).
- Editing the catalog at runtime (atlas.toml is source-controlled forever).
- Tile_edits population from the editor (only the import script writes here in PR B).
- Multiple worlds.

## Architecture

### New files

- `packages/burger-server/atlas.toml` — committed catalog of paintable tiles.
- `packages/burger-server/src/world.ts` — replaces `level.ts`. Reads atlas.toml, syncs `tile_catalog`, loads `tiles` rows into bitECS, applies world bounds.
- `packages/burger-server/scripts/import-ldtk.ts` — one-time import script.
- `packages/burger-server/test/world.test.ts` — covered below.
- `packages/burger-shared/src/world-bounds.ts` — the bounds clamp helper. Imported by `moveAndSlide`.

### Modified files

- `packages/burger-server/src/db.ts` — adds new tables to the migration.
- `packages/burger-server/src/server.ts` — drops `createLevel`, calls `createWorld` from world.ts.
- `packages/burger-shared/src/collision.ts` — `moveAndSlide` reads `world.bounds` and clamps the resulting position.
- `packages/burger-shared/src/world.shared.ts` — `SharedWorld` gains a `bounds: { x, y, w, h }` field (pixel coords).
- `packages/burger-server/src/players.ts` — uses `world.spawnZone` (read from settings) to pick a random spawn point.
- `packages/burger-server/src/network.server.ts` — sends bounds to client at YOUR_EID time (or via a new HELLO message — see protocol section).
- `packages/burger-client/src/network.client.ts` — receives bounds, populates `world.bounds`.
- `packages/burger-client/src/client.ts` — drops `/api/atlas` fetch in favor of `/api/catalog` (still server-driven). Tile sprite creation uses catalog data.

### Deleted files

- `packages/burger-server/src/level.ts`
- `packages/burger-server/src/burger.json` (moved to repo root or deleted after import; see Migration)
- The reference to `burger.json` in `.gitignore` stays (in case anyone re-imports later).

### Schema additions (in `db.ts`)

```sql
CREATE TABLE IF NOT EXISTS tile_catalog (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  src_x INTEGER NOT NULL,
  src_y INTEGER NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiles (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  tile_id INTEGER NOT NULL REFERENCES tile_catalog(id),
  PRIMARY KEY (x, y)
);

CREATE TABLE IF NOT EXISTS tile_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  old_tile_id INTEGER,
  new_tile_id INTEGER,
  user_id TEXT REFERENCES users(id),
  edited_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tile_edits_pos ON tile_edits(x, y);
CREATE INDEX IF NOT EXISTS tile_edits_time ON tile_edits(edited_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### atlas.toml format

```toml
# Tile catalog. Source of truth for what can be painted.
# id is stable forever — never reuse an id, even if you delete a tile.
# Adding a new tile: append a new entry with the next unused id.

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

# ... seeded by the import script from the existing burger.json customData
```

`type` is one of `floor`, `wall`, `counter`. `wall` and `counter` get `Solid` ECS components. `floor` doesn't.

The TOML is loaded at server boot via `import atlas from "../atlas.toml"` (Bun supports TOML imports natively, returns parsed object). On every boot, the server upserts each entry into `tile_catalog`:

```ts
for (const t of atlas.tiles) {
  db.run(
    "INSERT OR REPLACE INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?)",
    [t.id, t.type, t.src_x, t.src_y, t.label],
  );
}
```

Catalog rows that exist in the DB but not in TOML: log a warning, leave them in place (so existing `tiles.tile_id` references don't dangle). Don't auto-delete.

### Settings keys (seeded on first boot)

```
spawn_x        (px, default 0)
spawn_y        (px, default 0)
spawn_w        (px, default TILE_SIZE * 4)
spawn_h        (px, default TILE_SIZE * 4)
world_width    (px, default TILE_SIZE * 64 = 2048)
world_height   (px, default TILE_SIZE * 64 = 2048)
```

`db.ts` initializes any missing key with its default on boot. Existing values are not overwritten.

### `world.ts` flow on boot

```ts
export const initWorld = (db: Database) => {
  const world = createSharedWorld({
    spawnZone: readSpawnZone(db),
    bounds: readBounds(db),
    catalog: readCatalog(db),
    typeIdToAtlasSrc: {} as Record<string, [number, number]>,
  });

  syncCatalogFromToml(db);
  loadTilesIntoEcs(world, db);
  populateAtlasMapping(world);

  return world;
};
```

Each helper is small and testable.

`loadTilesIntoEcs` joins `tiles` with `tile_catalog`, creates a bitECS entity per tile (Position + Tile + Networked + Solid-if-wall-or-counter), and populates a tile index `world.tilesAtPosition: Map<string, number>` (key `"${x},${y}"`, value entity id) for PR C's paint handler.

**Tile.type semantics change.** Today `Tile.type[eid]` holds a `TileType` (numeric union: 0=floor, 1=wall, 2=counter — the values from `TILE_TYPES`). After PR B, `Tile.type[eid]` holds the **catalog ID** (a stable integer from atlas.toml, 1+). This is a wire-format change for the OBSERVER serializer, but the field is still a number on the bitecs side, so the serialization layer doesn't notice. Clients render tiles by looking up `Tile.type[eid]` in their catalog-id-keyed texture map (introduced in PR C; in PR B the client still uses `/api/atlas` and the existing typeIdToAtlasSrc indirection — built from the catalog so it Just Works for the existing TileType values).

To avoid a confusing rename, the bitecs component field stays `Tile.type` even though it now stores catalog IDs. The constant union `TILE_TYPES` (FLOOR/WALL/COUNTER) stays in burger-shared and is still used for the `type` string in catalog rows ("floor"/"wall"/"counter"), since solidness is determined by type string.

`populateAtlasMapping` builds the `world.typeIdToAtlasSrc` map (consumed by the existing `GET /api/atlas` endpoint) — this is now derived from the catalog instead of hand-tracked during level parsing. (PR C will switch the client to `/api/catalog`; PR B keeps `/api/atlas` working for compatibility.)

### World bounds

`SharedWorld` gains:

```ts
type SharedWorld = {
  components: typeof sharedComponents;
  time: { delta: number; elapsed: number; then: number };
  bounds: { x: number; y: number; w: number; h: number };
};
```

`bounds.x` and `bounds.y` are 0 by default but stored as settings so they could be non-zero in the future (for asymmetric worlds).

`moveAndSlide` adds a final clamp step:

```ts
// after collision resolution
const halfPlayer = PLAYER_SIZE / 2;
newX = Math.max(
  world.bounds.x + halfPlayer,
  Math.min(world.bounds.x + world.bounds.w - halfPlayer, newX),
);
newY = Math.max(
  world.bounds.y + halfPlayer,
  Math.min(world.bounds.y + world.bounds.h - halfPlayer, newY),
);
```

Both server and client use this (since `moveAndSlide` is in `burger-shared`). Client's `world.bounds` must be populated before any prediction tick runs.

### Bounds delivery to client

Two options:

1. Bundle bounds into the YOUR_EID payload. Currently it's `Int32Array([PROTOCOL_VERSION, eid])` (8 bytes). Extending to `Int32Array([PROTOCOL_VERSION, eid, bounds_x, bounds_y, bounds_w, bounds_h])` (24 bytes) is small.
2. Add a HELLO message before YOUR_EID with structured JSON.

Pick option 1 — minimal protocol change, tiny on the wire, matches existing pattern. PROTOCOL_VERSION bumps to 2 to flag the change.

In `network.server.ts`:

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

In `network.client.ts`'s YOUR_EID handler:

```ts
case MESSAGE_TYPES.YOUR_EID: {
  const view = new Int32Array(payload);
  const version = view[0];
  if (version !== PROTOCOL_VERSION) { /* unchanged disconnect logic */ }
  me.serverEid = view[1]!;
  world.bounds = { x: view[2]!, y: view[3]!, w: view[4]!, h: view[5]! };
  break;
}
```

### Spawn zone

`world.spawnZone: { x, y, w, h }` is read from settings on boot. `players.ts`:

```ts
export const createPlayer = (world: World, name: string): number => {
  const { spawnZone } = world;
  const x = spawnZone.x + Math.random() * spawnZone.w;
  const y = spawnZone.y + Math.random() * spawnZone.h;
  // ... rest unchanged, drops the randomItem(world.playerSpawns) lookup
};
```

`world.playerSpawns` (the array previously populated by LDtk) is removed.

### Import script

`packages/burger-server/scripts/import-ldtk.ts`:

1. Read `packages/burger-server/src/burger.json` (still gitignored, kept locally for the maintainer).
2. Open SQLite from `DB_PATH` (default `./data/burger.db`).
3. Parse LDtk's `defs.tilesets[0].customData` to build a map of `tileId → type` (existing logic from `level.ts`).
4. For each unique (src_x, src_y, type) found in `gridTiles`, ensure a row exists in `tile_catalog`. The TOML committed alongside this script is the canonical seed; the script's job is just to populate `tiles`.
5. For each `gridTile` in the LDtk export: look up the matching catalog ID by (src_x, src_y, type), `INSERT OR REPLACE INTO tiles (x, y, tile_id) VALUES (?, ?, ?)`, log a `tile_edits` row with `user_id = NULL` and a comment field if present.
6. Read `entityInstances` for `PlayerSpawn`. If present, write `spawn_x`, `spawn_y` to settings (taking the first spawn's coords; spawn_w / spawn_h stay at default). If multiple spawns, log a warning.
7. Print a summary: `Imported N tiles, set spawn to (x, y)`.

Run by maintainer:

```bash
pnpm --filter burger-server exec bun scripts/import-ldtk.ts
```

The script is idempotent: re-running it overwrites existing tiles to match the LDtk source. (Doesn't delete tiles that aren't in the LDtk export — those stay. If you want a clean slate, `DELETE FROM tiles` first.)

After running, the maintainer commits:

- The newly-populated `data/burger.db` is NOT committed (gitignored).
- The `atlas.toml` IS committed (it's the catalog seed).
- `level.ts` and `burger.json` deletion is part of the PR.

## Tests

`packages/burger-server/test/world.test.ts`:

- **Catalog sync**: write a fixture TOML to a temp file, sync to in-memory DB, assert `tile_catalog` rows match. Re-sync with a modified TOML, assert UPSERT works (changed labels apply).
- **Settings defaults**: open a fresh in-memory DB, run migrations, assert defaults are seeded for spawn and bounds.
- **Settings preservation**: pre-populate a setting, run migrations, assert the existing value is preserved (not overwritten).
- **Tile loading**: insert a few rows in `tiles`, call `loadTilesIntoEcs`, assert bitECS has the right entity count and that walls are Solid but floors are not.

`packages/burger-shared/test/collision.test.ts` gets one new test:

- **World bounds clamp**: place no walls, give player velocity that would push them past the boundary, assert moveAndSlide clamps to `bounds.w - PLAYER_SIZE/2`. Test both x and y, both directions.

## Risks for this PR

- **Catalog drift**: if the import script picks a `tile_id` that doesn't match the manually-curated `atlas.toml`, the world looks wrong. Mitigation: the script reads `atlas.toml` first and inserts catalog entries from it before importing tiles. If a tile in burger.json has no match in atlas.toml, the script errors and prints which (src_x, src_y, type) is missing — maintainer adds it to atlas.toml and reruns.
- **PROTOCOL_VERSION bump**: existing clients won't reconnect cleanly after PR B deploys. They get a version mismatch error and must reload. Acceptable for single-server self-hosted deployment.
- **World bounds break existing levels**: the imported world from burger.json fits within the default 64×64 bounds (it's small). If LDtk world is larger, the import script logs a warning and bumps `world_width` / `world_height` to accommodate.
- **Bounds clamp interacts with collision corner-correction**: `moveAndSlide`'s corner-nudge code may push the player slightly outside bounds before the final clamp. The clamp at the end handles this. Verified by tests.

## Branch & commit plan (within PR B)

1. `chore: add tile_catalog, tiles, tile_edits, settings tables`
2. `feat: add atlas.toml catalog and world.ts loader`
3. `feat: world bounds in SharedWorld and moveAndSlide`
4. `feat: protocol v2 sends bounds in YOUR_EID`
5. `feat: random spawn from spawnZone`
6. `chore: import-ldtk script`
7. `chore: delete level.ts and burger.json after import`
8. `test: world.ts and bounds clamp tests`

PR title: `SQLite tile store, world bounds, atlas.toml (PR B of 3)`
