# burger

> hi, may i take your order?

## Stack

- [`bitECS`](https://github.com/NateTheGreatt/bitECS): entity component system
- [`pixi.js`](https://pixijs.com/): client renderer
- [`elysia`](https://elysiajs.com/) on [`bun`](https://bun.com/): server
- [`vite`](https://vite.dev/): client dev/build
- [`pnpm`](https://pnpm.io/): workspace + package manager
- [`bun:sqlite`](https://bun.com/docs/api/sqlite): users, sessions, tile store

## Layout

```
packages/
  burger-shared/   ECS components, physics, types, collision (used by both)
  burger-server/   bun + elysia, authoritative tick loop, AI bots
  burger-client/   vite + pixi, prediction, reconciliation, interpolation
```

## Requirements

- Node 25
- `pnpm`
- `bun`

## Auth

burger uses [4orm](https://github.com/jackharrhy/4orm) for OAuth. All WebSocket connections require a valid session — anonymous play is not supported.

Before running the server, register burger as an OAuth client in 4orm's `oauth2_clients.toml`:

```toml
[clients.burger]
client_name = "burger"
redirect_uris = [
    "http://big.burger.beauty/auth/4orm/callback",
    "http://localhost:5000/auth/4orm/callback",
]
scope = "openid profile"
```

Set env vars when running the server:

```
FOURM_URL=https://4orm.jackharrhy.dev   # base URL of 4orm
FOURM_CLIENT_ID=burger
BURGER_URL=http://localhost:5000        # base URL of burger (production: http://big.burger.beauty)
DB_PATH=./data/burger.db                # default; SQLite path for users/sessions
```

The first user signing in inherits their `is_admin` flag from 4orm. Sessions persist in SQLite for 30 days.

## World data

Tiles, the tile catalog, and world settings (spawn zone, world bounds) live in the same SQLite database as users and sessions. The catalog is seeded from `packages/burger-server/atlas.toml` on every server boot — that file is the source of truth for what tiles exist; edit it and restart the server to add new tiles. Tile placements (`tiles` table) are written by the import script or by admins painting in-game (PR C).

To bootstrap from an LDtk export:

```bash
DB_PATH=./data/burger.db pnpm --filter burger-server exec bun scripts/import-ldtk.ts
```

Requires `packages/burger-server/src/burger.json` (gitignored) to be present. Re-running the script is idempotent — existing tiles are overwritten to match the LDtk source; tiles painted later that aren't in the LDtk export are preserved.

## Editor

Admins (per 4orm `is_admin`) can paint tiles in-game. Press `e` to toggle edit mode. The bottom-of-screen palette shows every catalog entry. Left-click paints, right-click erases. Number keys 1-9 select palette slots; mouse wheel cycles. Each paint is server-authoritative, persisted to SQLite, and broadcast to all connected clients.

The catalog is defined in `packages/burger-server/atlas.toml`. Edit it and restart the server to add new tiles.

## Scripts (root)

```bash
pnpm install                # install all workspace deps

pnpm dev                    # run server + client together via concurrently
pnpm dev:server             # run the server with file-watch (DEBUG=burger:*)
pnpm dev:client             # run the vite dev server (proxies /ws and /api to :5000)

pnpm build-frontend         # tsc + vite build the client into packages/burger-client/dist
pnpm copy-frontend          # copy that dist into packages/burger-server/public for prod
pnpm prod:server            # run the server without watch (serves /public)

pnpm test                   # run bun tests in every package
pnpm format                 # prettier the whole workspace
```

`pnpm dev` opens vite on `:5173` (proxied to the server on `:5000`).

## Docker

```bash
docker compose up --build
# server on http://127.0.0.1:5000
```

## Tests

```bash
pnpm test
```
