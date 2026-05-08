# burger

> hi, may i take your order?

A small multiplayer 2D top-down game with Quake-style netcode (client-side
prediction, server reconciliation, entity interpolation).

## Stack

- [`bitECS`](https://github.com/NateTheGreatt/bitECS) — entity component system
- [`pixi.js`](https://pixijs.com/) — client renderer
- [`elysia`](https://elysiajs.com/) on [`bun`](https://bun.com/) — server
- [`vite`](https://vite.dev/) — client dev/build
- [`pnpm`](https://pnpm.io/) — workspace + package manager
- [LDtk](https://ldtk.io/) — level format

## Layout

```
packages/
  burger-shared/   ECS components, physics, types, collision (used by both)
  burger-server/   bun + elysia, authoritative tick loop, AI bots
  burger-client/   vite + pixi, prediction, reconciliation, interpolation
```

## Requirements

- Node 25 (see `.tool-versions`)
- `pnpm` (`npm i -g pnpm`)
- `bun` (`npm i -g bun`) — server runtime + test runner

## Scripts (root)

```bash
pnpm install                # install all workspace deps

pnpm dev:server             # run the server with file-watch (DEBUG=burger:*)
pnpm dev:client             # run the vite dev server (proxies /ws and /api to :5000)

pnpm build-frontend         # tsc + vite build the client into packages/burger-client/dist
pnpm copy-frontend          # copy that dist into packages/burger-server/public for prod
pnpm prod:server            # run the server without watch (serves /public)

pnpm test                   # run bun tests in every package
pnpm format                 # prettier the whole workspace
```

Typical local-dev flow: run `pnpm dev:server` in one terminal and
`pnpm dev:client` in another, then open the URL vite prints.

Production-style flow: `pnpm build-frontend && pnpm copy-frontend && pnpm prod:server`.

## Per-package scripts

You can also target a single package directly:

```bash
pnpm --filter burger-client dev
pnpm --filter burger-client build
pnpm --filter burger-client preview

pnpm --filter burger-server dev
pnpm --filter burger-server start
pnpm --filter burger-server test

pnpm --filter burger-shared test
```

## Docker

```bash
docker compose up --build
# server on http://127.0.0.1:5000
```

## Tests

```bash
pnpm test
```

Runs `bun test` across `burger-shared` and `burger-server`. The server suite
includes e2e tests that spin up a real Elysia server on a random port and
connect a real WebSocket client, exercising the input-validation pipeline,
per-tick rate cap, replay rejection, protocol version handshake, and disconnect
cleanup.
