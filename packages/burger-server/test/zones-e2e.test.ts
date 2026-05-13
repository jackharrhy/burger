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

const setupSession = (
  database: Database,
  isAdmin: boolean,
  id?: string,
): string => {
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

// Lenient response shape: every field is optional, every value is typed
// as a reasonable union. Avoids per-call type parameters in this e2e file
// while keeping access-site typechecking honest.
type Resp = {
  id?: number;
  name?: string;
  zones?: { id: number; name?: string; cells?: [number, number][] }[];
  member_user_ids?: string[];
  cell_count?: number;
  added?: number;
  removed?: number;
  dropped?: number;
  users?: { id: string; display_name: string | null }[];
  ok?: boolean;
};

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
  const data = (await res.json().catch(() => null)) as Resp;
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
    {
      add: [
        [16, 16],
        [48, 16],
      ],
      remove: [],
    },
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

  expect(world.zones.get(c.data.id!)?.cells.size).toBe(1);
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
  expect(r.data.zones).toEqual([{ id: c.data.id!, cells: [[16, 16]] }]);
});

test("admin GET /api/users returns id + display_name list", async () => {
  const sess = setupSession(db, true);
  setupSession(db, false, "alice");
  const r = await req("GET", "/api/users", undefined, sess);
  expect(r.status).toBe(200);
  const ids = (r.data.users as { id: string }[]).map((u) => u.id).sort();
  expect(ids).toEqual(["admin1", "alice"]);
});
