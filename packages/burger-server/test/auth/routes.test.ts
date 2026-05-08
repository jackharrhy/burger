import { expect, test, mock, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { runMigrations } from "../../src/db";
import { authRoutes } from "../../src/auth/routes";
import type { AuthConfig } from "../../src/auth/config";

const cfg: AuthConfig = {
  fourmUrl: "http://4orm.test",
  burgerUrl: "http://burger.test",
  clientId: "burger",
  isProduction: false,
};

const buildApp = (db: Database) => new Elysia().use(authRoutes({ db, config: cfg }));

beforeEach(() => {
  globalThis.fetch = (() => { throw new Error("fetch not mocked"); }) as any;
});

test("GET /auth/4orm sets oauth cookie and redirects to 4orm authorize", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  const app = buildApp(db);
  const res = await app.handle(new Request("http://burger.test/auth/4orm"));
  expect(res.status).toBe(302);
  const location = res.headers.get("location")!;
  expect(location.startsWith("http://4orm.test/oauth/authorize?")).toBe(true);
  expect(location).toContain("client_id=burger");
  expect(location).toContain("redirect_uri=http%3A%2F%2Fburger.test%2Fauth%2F4orm%2Fcallback");
  expect(location).toContain("scope=openid+profile");
  expect(location).toContain("code_challenge=");
  expect(location).toContain("code_challenge_method=S256");
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toContain("burger_oauth=");
  expect(setCookie).toContain("HttpOnly");
});

test("callback with valid code+state upserts user and creates session", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  const app = buildApp(db);

  const startRes = await app.handle(new Request("http://burger.test/auth/4orm"));
  const cookieHeader = startRes.headers.get("set-cookie")!;
  const oauthCookieMatch = cookieHeader.match(/burger_oauth=([^;]+)/)!;
  const oauthCookie = oauthCookieMatch[1];
  const state = JSON.parse(decodeURIComponent(oauthCookie!)).state;

  globalThis.fetch = mock(async (url: string) => {
    if (url === "http://4orm.test/oauth/token") {
      return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }));
    }
    if (url === "http://4orm.test/oauth/userinfo") {
      return new Response(JSON.stringify({ sub: "fid1", username: "jack", display_name: "Jack", is_admin: true }));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as any;

  const callbackRes = await app.handle(
    new Request(`http://burger.test/auth/4orm/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: `burger_oauth=${oauthCookie}` },
    }),
  );

  expect(callbackRes.status).toBe(302);
  expect(callbackRes.headers.get("location")).toBe("/");

  const user = db.query("SELECT * FROM users WHERE fourm_id = 'fid1'").get() as any;
  expect(user.username).toBe("jack");
  expect(user.is_admin).toBe(1);

  const sessionCount = db.query("SELECT COUNT(*) as c FROM sessions").get() as any;
  expect(sessionCount.c).toBe(1);
});

test("callback with state mismatch redirects with error", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  const app = buildApp(db);
  const startRes = await app.handle(new Request("http://burger.test/auth/4orm"));
  const oauthCookie = startRes.headers.get("set-cookie")!.match(/burger_oauth=([^;]+)/)![1];

  const res = await app.handle(
    new Request("http://burger.test/auth/4orm/callback?code=abc&state=wrong", {
      headers: { Cookie: `burger_oauth=${oauthCookie}` },
    }),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=state_mismatch");
});

test("callback with 4orm error param propagates to /", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  const app = buildApp(db);
  const res = await app.handle(
    new Request("http://burger.test/auth/4orm/callback?error=access_denied"),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=access_denied");
});

test("GET /auth/me with valid session returns user", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["u1", "fid1", "jack", "Jack", 1, Date.now()],
  );
  db.run(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    ["sess1", "u1", Date.now() + 1000_000],
  );
  const app = buildApp(db);

  const res = await app.handle(
    new Request("http://burger.test/auth/me", {
      headers: { Cookie: "burger_session=sess1" },
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ id: "u1", username: "jack", displayName: "Jack", isAdmin: true });
});

test("GET /auth/me without session returns 401", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  const app = buildApp(db);
  const res = await app.handle(new Request("http://burger.test/auth/me"));
  expect(res.status).toBe(401);
});

test("POST /auth/logout deletes the session", async () => {
  const db = new Database(":memory:"); runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
    ["u1", "fid1", "jack", 0, Date.now()],
  );
  db.run(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    ["sess1", "u1", Date.now() + 1000_000],
  );
  const app = buildApp(db);
  const res = await app.handle(
    new Request("http://burger.test/auth/logout", {
      method: "POST",
      headers: { Cookie: "burger_session=sess1" },
    }),
  );
  expect(res.status).toBe(204);
  const remaining = db.query("SELECT COUNT(*) as c FROM sessions").get() as any;
  expect(remaining.c).toBe(0);
});
