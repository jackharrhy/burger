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
