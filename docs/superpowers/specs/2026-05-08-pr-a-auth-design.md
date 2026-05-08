# PR A — Auth

Status: approved
Part of: [`2026-05-08-editor-and-auth-overview.md`](./2026-05-08-editor-and-auth-overview.md)

## Goal

Require all WebSocket connections to be authenticated via 4orm OAuth. Introduce SQLite (used here for users + sessions; tiles come in PR B). After this PR, anonymous play is no longer possible.

## Non-goals (this PR)

- Tile painting, the editor UI, or the tile catalog (PR C / PR B).
- The SQLite-backed tile store (PR B).
- LDtk removal — PR A still uses LDtk for the level.

## Architecture

### New files

- `packages/burger-server/src/db.ts` — opens `bun:sqlite` connection from `DB_PATH` env (default `./data/burger.db`), runs `CREATE TABLE IF NOT EXISTS` migrations on boot, exports the `Database` instance.
- `packages/burger-server/src/auth/oauth.ts` — `generateCodeVerifier`, `generateCodeChallenge`, `exchangeCode`, `fetchUserinfo`. Pure functions.
- `packages/burger-server/src/auth/sessions.ts` — `createSession`, `getSession`, `deleteSession`, `parseSessionCookie`, `getSessionCookie`, `getClearSessionCookie`. Backed by SQLite.
- `packages/burger-server/src/auth/users.ts` — `upsertUserFromUserinfo({ sub, username, display_name, is_admin })`. Returns the local user row.
- `packages/burger-server/src/auth/routes.ts` — Elysia plugin defining `GET /auth/4orm`, `GET /auth/4orm/callback`, `POST /auth/logout`, `GET /auth/me`.
- `packages/burger-client/src/auth.client.ts` — `fetchMe()`, `signIn()`, `signOut()`. Small.
- `packages/burger-server/test/auth/oauth.test.ts`, `sessions.test.ts`, `routes.test.ts` — covered below.

### Modified files

- `packages/burger-server/src/network.server.ts` — WS `open` handler reads session cookie, looks up user, attaches to PlayerConnection, rejects with close code 4001 on failure.
- `packages/burger-server/src/server.ts` — registers the auth Elysia plugin, opens the DB before starting the server.
- `packages/burger-server/src/players.ts` — `createPlayer` accepts a display name parameter; bots keep using "Bot N" hardcoded.
- `packages/burger-client/src/client.ts` — boot flow gated behind `fetchMe()`; if 401, render a sign-in button instead of connecting WS.
- `packages/burger-server/package.json` — no new deps (Bun's built-ins cover everything).
- `compose.yml` — adds `volumes: - ./data:/app/data`.
- `.gitignore` — adds `data/`.

### Schema (in `db.ts`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  fourm_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
```

`db.ts` also runs `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` on startup.

### OAuth flow

Pure-mirror of `artbin/.../auth.4orm.tsx` and `auth.4orm.callback.tsx`, ported from React Router loaders to Elysia route handlers:

1. `GET /auth/4orm`:
   - Generate PKCE verifier (32 random bytes, base64url) + challenge (sha256 of verifier, base64url).
   - Generate state (UUID).
   - Set httpOnly `burger_oauth` cookie containing `{ verifier, state }` JSON-encoded, max-age 600s, SameSite=Lax, Secure if NODE_ENV=production.
   - Redirect to `${FOURM_URL}/oauth/authorize?response_type=code&client_id=${FOURM_CLIENT_ID}&redirect_uri=${redirectUri}&scope=openid+profile&state=...&code_challenge=...&code_challenge_method=S256`.

2. `GET /auth/4orm/callback`:
   - Read `code`, `state`, `error` from query.
   - On `error`: redirect to `/?error=${error}`.
   - Read `burger_oauth` cookie, validate state matches.
   - Call `exchangeCode(code, verifier, redirectUri)` (POST to `${FOURM_URL}/oauth/token`).
   - Call `fetchUserinfo(access_token)` (GET `${FOURM_URL}/oauth/userinfo`).
   - Upsert local user by `fourm_id === sub`. Sync `username`, `display_name`, `is_admin` on every login (matches artbin).
   - Create a session row, expires 30 days out. Random 32-char ID.
   - Clear `burger_oauth` cookie (Max-Age=0). Set `burger_session` cookie.
   - Redirect to `/`.

3. `POST /auth/logout`: read session cookie, delete the session row, clear the cookie. 204 response.

4. `GET /auth/me`: read session cookie, look up user. If valid: return `{ id, username, displayName, isAdmin }` as JSON. If invalid/missing: 401 with empty body.

### Env vars

```
DB_PATH=./data/burger.db                          # default; configurable
FOURM_URL=https://4orm.harrhy.xyz             # 4orm base URL
FOURM_CLIENT_ID=burger
BURGER_URL=https://big.burger.beauty               # production base URL
NODE_ENV=production                               # affects cookie Secure flag
```

`redirect_uri` is `${BURGER_URL}/auth/4orm/callback` (with trailing slash handling).

For local development:

```
FOURM_URL=http://localhost:8000
BURGER_URL=http://localhost:5000   # NOT 5173 — auth must run through Elysia, vite dev server proxies it
```

### 4orm configuration (manual, prerequisite)

Maintainer must add to `/Users/jack/repos/personal/4orm/oauth2_clients.toml` and deploy 4orm:

```toml
[clients.burger]
client_name = "burger"
redirect_uris = [
    "https://big.burger.beauty/auth/4orm/callback",
    "http://localhost:5000/auth/4orm/callback",
]
scope = "openid profile"
```

PR A's README/spec calls this out as a prerequisite.

### WS authentication

In `network.server.ts`, the `ws.open` handler currently runs `onPlayerJoin()` unconditionally. Change to:

1. Pull the cookie header from `ws.data.request.headers.get("cookie")` (or however Elysia exposes it; verify in implementation).
2. Parse `burger_session` cookie. If missing or invalid session: `ws.close(4001, "unauthenticated")`, return.
3. Otherwise, resolve `user` from session.
4. Call `onPlayerJoin(user.displayName ?? user.username)` (signature change to accept a name).
5. Store `userId`, `username`, `isAdmin` on the PlayerConnection. (PR C uses `isAdmin` to gate paints.)

If the session expires during a connection: server doesn't actively kick. Sessions are checked only at WS open time. (Keeps the loop simple. The 30-day window is generous enough that this isn't user-visible.)

### Client boot flow

`packages/burger-client/src/client.ts`'s `setup()` becomes:

```ts
const me = await fetchMe();
if (!me) {
  renderSignInScreen();
  return;
}
context.me.user = me;
await setupRenderer();
setupSocket({ ... });
```

`renderSignInScreen()` is a tiny DOM-only function that injects an HTML `<div>` with a "Sign in with 4orm" button. Clicking navigates to `/auth/4orm`. No Pixi, no WebSocket. After auth, the user lands back at `/`, the SPA runs again, `fetchMe()` succeeds, the game starts.

`auth.client.ts`:

```ts
export type Me = {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
};

export const fetchMe = async (): Promise<Me | null> => {
  const res = await fetch("/auth/me");
  if (res.status !== 200) return null;
  return res.json();
};

export const signOut = async (): Promise<void> => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.reload();
};
```

A small "signed in as X · sign out" element is added to the existing lil-gui or as a small DOM corner overlay.

### Vite dev proxy

`packages/burger-client/vite.config.ts` already proxies `/api` and `/ws` to `:5000`. Add `/auth/*` so the OAuth flow works through `pnpm dev`:

```ts
proxy: {
  "/api": { target: "http://localhost:5000", changeOrigin: true },
  "/auth": { target: "http://localhost:5000", changeOrigin: true },
  "/ws": { target: "ws://localhost:5000/", ws: true, changeOrigin: true },
}
```

This means OAuth callbacks during dev land at `localhost:5000` (Elysia handles them and 302s back to `/`, which Vite serves). Both work because the redirect_uri in the 4orm client config is `:5000` directly.

Alternative: add the `/auth` proxy and have OAuth round-trip through `:5173`. Pick the first because session cookies on `:5000` need to flow over the WS upgrade to `:5000`, so keeping everything on `:5000` is cleanest.

## Tests

`packages/burger-server/test/auth/`:

- **`oauth.test.ts`** — pure-function tests:
  - `generateCodeVerifier` returns base64url string of 32+ bytes.
  - `generateCodeChallenge(verifier)` matches a known fixture.
  - `exchangeCode` and `fetchUserinfo` are tested via mock-fetch (Bun has `mock()` for `fetch`).

- **`sessions.test.ts`** — runs against an in-memory SQLite (`new Database(":memory:")`) seeded with the schema:
  - `createSession` returns an ID, inserts a row, sets expires_at correctly.
  - `getSession` returns the session for a valid ID, null for unknown, null for expired (and deletes the expired row).
  - `deleteSession` removes the row.
  - `parseSessionCookie` parses correctly, returns undefined on absence.

- **`routes.test.ts`** — spins up the Elysia auth plugin against an in-memory DB, with `fetch` mocked to return canned 4orm responses:
  - `GET /auth/4orm` → 302 to 4orm with correct query params, sets `burger_oauth` cookie.
  - `GET /auth/4orm/callback` with valid code+state → upserts user, creates session, sets `burger_session` cookie, 302 to `/`.
  - Callback with state mismatch → 302 to `/?error=state_mismatch`, no session created.
  - Callback with 4orm `error=...` → 302 to `/?error=...`, no fetch.
  - `GET /auth/me` with valid session → 200 with user JSON.
  - `GET /auth/me` without session → 401.
  - `POST /auth/logout` deletes the session.

The existing e2e netcode tests (`packages/burger-server/test/e2e.test.ts`) need updating: they currently connect anonymously. They must now create a user + session in the test DB, then attach `Cookie: burger_session=...` to the WS upgrade. A small helper `connectAuthenticated(port, sessionId)` wraps this.

## Risks for this PR

- **WS upgrade cookie access in Elysia.** Need to confirm the API for reading request headers in the `ws.open` handler. If awkward, fallback is to authenticate via a query param: `/ws?session=...`. The query-param approach leaks the session ID into server logs, so cookies are preferred. Verify in implementation.
- **Cookie SameSite for the OAuth redirect.** The `burger_oauth` state cookie must survive the cross-site redirect from 4orm back to burger. `SameSite=Lax` allows this for top-level navigations, which is what OAuth callbacks are. Matches artbin.
- **First-login admin bootstrap.** When the very first user signs in, the upsert creates them with `is_admin = userinfo.is_admin`. This relies on 4orm correctly reporting admin status. If 4orm returns `is_admin: true` only for the first user, that's fine; if it's based on some other criteria, that's outside burger's control.

## Migration notes

- Existing `big.burger.beauty` deployment has no `data/` volume yet. Compose change adds it. On first deploy after PR A, the DB is created fresh.
- The first user to log in via 4orm is the maintainer; their `is_admin` flag flows from 4orm. Verified by inspecting `users` row after first login.
- No data migration is needed (no users existed before).

## Branch & commit plan (within PR A)

1. `chore: add bun:sqlite db.ts with users and sessions schema`
2. `feat: add oauth.ts and sessions.ts`
3. `feat: add elysia auth routes`
4. `feat: gate ws connections on session cookie`
5. `feat: client sign-in screen and /auth/me check`
6. `chore: vite proxy for /auth, gitignore data/, compose volume`
7. `test: oauth, sessions, routes tests + update e2e`

PR title: `Auth: 4orm OAuth, sessions, gate WS on auth (PR A of 3)`
