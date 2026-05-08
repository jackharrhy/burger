import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db";

test("runMigrations creates users table", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  expect(row).toEqual({ name: "users" });
});

test("runMigrations creates sessions table", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  expect(row).toEqual({ name: "sessions" });
});

test("runMigrations is idempotent", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  runMigrations(db);
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const names = tables.map((t: any) => t.name);
  expect(names).toContain("users");
  expect(names).toContain("sessions");
});

test("runMigrations enables foreign keys", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(row.foreign_keys).toBe(1);
});

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
