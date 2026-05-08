# burger

> hi, may i take your order?

## Stack

- [`bitECS`](https://github.com/NateTheGreatt/bitECS): entity component system
- [`pixi.js`](https://pixijs.com/): client renderer
- [`elysia`](https://elysiajs.com/) on [`bun`](https://bun.com/): server
- [`vite`](https://vite.dev/): client dev/build
- [`pnpm`](https://pnpm.io/): workspace + package manager
- [LDtk](https://ldtk.io/): level format

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
