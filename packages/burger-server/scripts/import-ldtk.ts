/**
 * One-time LDtk → SQLite import.
 *
 * Reads packages/burger-server/src/burger.json (the existing LDtk export).
 * Populates tile_catalog from the LDtk customData (tileId → type) and the
 * unique (src_x, src_y, type) tuples found in gridTiles.
 * Populates tiles from gridTiles. Logs every insert in tile_edits.
 * Sets spawn_x/spawn_y from the first PlayerSpawn entity.
 *
 * Usage:
 *   pnpm --filter burger-server exec bun scripts/import-ldtk.ts
 *
 * Idempotent. Re-running overwrites existing tiles to match the LDtk source.
 * Does NOT delete tiles that aren't in the LDtk export.
 */
import { Database } from "bun:sqlite";
import { TILE_SIZE } from "burger-shared";
import { runMigrations } from "../src/db";
import burgerLevel from "../src/burger.json";

type LayerCustomData = { tileId: number; data: string };
type GridTile = { t: number; px: [number, number]; src: [number, number] };
type EntityInstance = {
  __identifier: string;
  __worldX: number;
  __worldY: number;
};

const TYPE_MAP: Record<string, string> = {
  floor: "floor",
  wall: "wall",
  counter: "counter",
};

const dbPath = process.env.DB_PATH ?? "./data/burger.db";
console.log(`importing into ${dbPath}`);
const db = new Database(dbPath);
runMigrations(db);

// Step 1: tileId → type from LDtk customData
const tilesets = burgerLevel.defs.tilesets[0];
if (!tilesets) throw new Error("no tilesets in burger.json");

const tileIdToType: Record<number, string> = {};
for (const { tileId, data } of tilesets.customData as LayerCustomData[]) {
  const parsed: string = JSON.parse(data);
  const mapped = TYPE_MAP[parsed.toLowerCase()];
  if (!mapped) {
    console.warn(`tile ${tileId} has unknown type "${parsed}"; skipping`);
    continue;
  }
  tileIdToType[tileId] = mapped;
}

// Step 2: build catalog from unique (src_x, src_y, type) tuples in gridTiles
const level = burgerLevel.levels[0];
if (!level) throw new Error("no level in burger.json");
const layerTiles = level.layerInstances[1];
if (!layerTiles) throw new Error("no tile layer (index 1)");

const gridTiles = layerTiles.gridTiles as GridTile[];

type CatalogPending = {
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};
const catalogByKey = new Map<string, CatalogPending>();
for (const { t, src } of gridTiles) {
  const type = tileIdToType[t];
  if (!type) continue;
  const key = `${type}-${src[0]}-${src[1]}`;
  if (!catalogByKey.has(key)) {
    catalogByKey.set(key, {
      type,
      src_x: src[0],
      src_y: src[1],
      label: `${type} ${src[0]},${src[1]}`,
    });
  }
}

const insertCatStmt = db.prepare(
  "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, src_x = excluded.src_x, src_y = excluded.src_y, label = excluded.label",
);

// Reuse existing catalog rows that match (type, src_x, src_y).
const catalogKeyToId = new Map<string, number>();
let nextId = 1;
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

// Step 3: insert tiles
const insertTileStmt = db.prepare(
  "INSERT INTO tiles (x, y, tile_id) VALUES (?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET tile_id = excluded.tile_id",
);
const insertEditStmt = db.prepare(
  "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (?, ?, ?, ?, ?, ?)",
);
let tileCount = 0;
const now = Date.now();
// LDtk's gridTiles px[] is the cell's TOP-LEFT in world pixels. The runtime
// uses cell-CENTER coordinates everywhere (sprite anchor 0.5; collision
// formula compares centers). Shift by half a tile during import so all
// coordinate systems agree downstream.
const halfTile = TILE_SIZE / 2;
for (const { t, px, src } of gridTiles) {
  const type = tileIdToType[t];
  if (!type) continue;
  const key = `${type}-${src[0]}-${src[1]}`;
  const catId = catalogKeyToId.get(key);
  if (!catId) continue;
  const x = px[0] + halfTile;
  const y = px[1] + halfTile;

  const old = db
    .query("SELECT tile_id FROM tiles WHERE x = ? AND y = ?")
    .get(x, y) as { tile_id: number } | undefined;
  insertTileStmt.run(x, y, catId);
  insertEditStmt.run(x, y, old?.tile_id ?? null, catId, null, now);
  tileCount++;
}
console.log(`tiles imported: ${tileCount}`);

// Step 4: spawn from first PlayerSpawn
const entities = level.layerInstances[0];
if (entities) {
  for (const entity of entities.entityInstances as EntityInstance[]) {
    if (entity.__identifier === "PlayerSpawn") {
      // Same top-left → center shift as tiles.
      const sx = entity.__worldX + halfTile;
      const sy = entity.__worldY + halfTile;
      db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ["spawn_x", String(sx)],
      );
      db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ["spawn_y", String(sy)],
      );
      console.log(
        `spawn set to (${sx}, ${sy})`,
      );
      break;
    }
  }
}

console.log("import done");
db.close();
