# burger

> hi, may i take your order?

## Stack

- [`bitECS`](https://github.com/NateTheGreatt/bitECS): entity component system
- [`pixi.js`](https://pixijs.com/): client renderer
- [`elysia`](https://elysiajs.com/) on [`bun`](https://bun.com/): server
- [`vite`](https://vite.dev/): client dev/build
- [`pnpm`](https://pnpm.io/): workspace + package manager
- [`bun:sqlite`](https://bun.com/docs/api/sqlite): users, sessions, tile store
- [`oxlint`](https://oxc.rs/docs/guide/usage/linter) + [`oxfmt`](https://oxc.rs/docs/guide/usage/formatter): lint + format

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

burger uses [4orm](https://github.com/jackharrhy/4orm) for OAuth. WebSocket connections require a valid session.

## Scripts (root)

```bash
pnpm install                # install all workspace deps

pnpm dev                    # run server + client together via concurrently
pnpm dev:server             # run the server with file-watch (DEBUG=burger:*)
pnpm dev:client             # run the vite dev server (proxies /auth /api /ws to :5000)

pnpm build-frontend         # tsc + vite build the client into packages/burger-client/dist
pnpm copy-frontend          # copy that dist into packages/burger-server/public for prod
pnpm prod:server            # run the server without watch (serves /public)

pnpm test                   # run bun tests in every package
pnpm typecheck              # tsc --noEmit across all packages
pnpm lint                   # oxlint
pnpm fmt                    # oxfmt — write
pnpm fmt:check              # oxfmt — check (used in CI)
```

`pnpm dev` opens vite on `:5173` (proxied to the server on `:5000`).

## Docker

```bash
docker compose up --build
# server on http://127.0.0.1:5000
```
