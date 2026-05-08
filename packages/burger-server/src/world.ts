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

const loadTilesIntoEcs = (
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

  const typeIdToAtlasSrc: Record<number, [number, number]> = {};
  for (const [id, entry] of catalog) {
    typeIdToAtlasSrc[id] = [entry.src_x, entry.src_y];
  }

  const world = createSharedWorld<WorldExtras>({
    catalog,
    catalogIds: new Set(catalog.keys()),
    tilesAtPosition: new Map<string, number>(),
    spawnZone,
    typeIdToAtlasSrc,
  });

  world.bounds = {
    x: 0,
    y: 0,
    w: parseInt(settings.world_width ?? String(TILE_SIZE * 64), 10),
    h: parseInt(settings.world_height ?? String(TILE_SIZE * 64), 10),
  };

  loadTilesIntoEcs(world, db);

  return world;
};

export type World = ReturnType<typeof initWorld>;
