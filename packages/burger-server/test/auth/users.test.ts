import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db";
import { upsertUserFromUserinfo, getUserById } from "../../src/auth/users";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
};

test("upsertUserFromUserinfo creates a new user on first call", () => {
  const db = setupDb();
  const u = upsertUserFromUserinfo(db, {
    sub: "fid1",
    username: "jack",
    display_name: "Jack",
    is_admin: true,
  });
  expect(u.username).toBe("jack");
  expect(u.displayName).toBe("Jack");
  expect(u.isAdmin).toBe(true);
  expect(u.id.length).toBeGreaterThan(0);
});

test("upsertUserFromUserinfo returns same user on second call (by fourm_id)", () => {
  const db = setupDb();
  const u1 = upsertUserFromUserinfo(db, {
    sub: "fid1",
    username: "jack",
    is_admin: false,
  });
  const u2 = upsertUserFromUserinfo(db, {
    sub: "fid1",
    username: "jack",
    is_admin: false,
  });
  expect(u2.id).toBe(u1.id);
});

test("upsertUserFromUserinfo updates username and is_admin on subsequent calls", () => {
  const db = setupDb();
  const u1 = upsertUserFromUserinfo(db, {
    sub: "fid1",
    username: "old",
    is_admin: false,
  });
  const u2 = upsertUserFromUserinfo(db, {
    sub: "fid1",
    username: "new",
    display_name: "New",
    is_admin: true,
  });
  expect(u2.id).toBe(u1.id);
  expect(u2.username).toBe("new");
  expect(u2.displayName).toBe("New");
  expect(u2.isAdmin).toBe(true);
});

test("getUserById returns the user", () => {
  const db = setupDb();
  const u = upsertUserFromUserinfo(db, {
    sub: "fid1",
    username: "jack",
    is_admin: false,
  });
  const fetched = getUserById(db, u.id);
  expect(fetched?.username).toBe("jack");
});

test("getUserById returns null for missing user", () => {
  const db = setupDb();
  expect(getUserById(db, "missing")).toBeNull();
});
