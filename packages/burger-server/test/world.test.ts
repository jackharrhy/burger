import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db";
import {
  syncCatalog,
  seedDefaultSettings,
  readSettings,
  loadCatalog,
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
    .all() as Array<{
    id: number;
    type: string;
    src_x: number;
    src_y: number;
    label: string;
  }>;
  expect(rows).toEqual([
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
});

test("syncCatalog updates existing rows by id", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
  ]);
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "renamed" },
  ]);
  const row = db.query("SELECT label FROM tile_catalog WHERE id = 1").get() as {
    label: string;
  };
  expect(row.label).toBe("renamed");
});

test("syncCatalog leaves DB rows not in TOML in place (warning only)", () => {
  const db = setupDb();
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
  // World 2048x2048, default spawn 128x128, centered: (2048-128)/2 = 960
  expect(settings.world_width).toBe(String(64 * 32));
  expect(settings.world_height).toBe(String(64 * 32));
  expect(settings.spawn_w).toBe("128");
  expect(settings.spawn_h).toBe("128");
  expect(settings.spawn_x).toBe("960");
  expect(settings.spawn_y).toBe("960");
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

test("seedDefaultSettings centers spawn against existing world dimensions", () => {
  const db = setupDb();
  // Pre-seed a non-default world; spawn defaults should respect it.
  db.run("INSERT INTO settings (key, value) VALUES ('world_width', '1024')");
  db.run("INSERT INTO settings (key, value) VALUES ('world_height', '512')");
  seedDefaultSettings(db);
  const settings = readSettings(db);
  // (1024 - 128) / 2 = 448, (512 - 128) / 2 = 192
  expect(settings.spawn_x).toBe("448");
  expect(settings.spawn_y).toBe("192");
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
  // Use catalog ids in a range outside atlas.toml's reserved set so initWorld's
  // own atlas.toml sync doesn't overwrite our test fixtures.
  syncCatalog(db, [
    { id: 100, type: "floor", src_x: 0, src_y: 0, label: "f" },
    { id: 101, type: "wall", src_x: 32, src_y: 0, label: "w" },
  ]);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (32, 64, 101)");
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (96, 64, 100)");
  seedDefaultSettings(db);

  const world = initWorld(db);
  const { Position, Tile, Solid } = world.components;
  const { query } = require("bitecs");
  const tiles = query(world, [Position, Tile]);
  // Two seeded tiles; atlas.toml entries don't add tiles, only catalog rows.
  expect(tiles.length).toBe(2);

  const solid = query(world, [Position, Solid]);
  expect(solid.length).toBe(1);

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
  // Default spawn centered in the default 2048x2048 world.
  expect(world.spawnZone.x).toBe(960);
  expect(world.spawnZone.y).toBe(960);
});

test("initWorld populates atlasInfo from atlas.toml meta", () => {
  const db = setupDb();
  seedDefaultSettings(db);
  const world = initWorld(db);
  expect(world.atlasInfo.width).toBe(448);
  expect(world.atlasInfo.height).toBe(448);
  // version is a non-empty cache-bust string (hash hex or boot timestamp).
  expect(typeof world.atlasInfo.version).toBe("string");
  expect(world.atlasInfo.version.length).toBeGreaterThan(0);
});
