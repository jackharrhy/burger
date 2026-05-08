# Phase 1: Client → React Router v7 + Eden + Zustand

Status: approved
Date: 2026-05-08
Branch: `client-react-router-eden`

## Goal

Convert `burger-client` from an imperative-DOM-bootstrap SPA into a React app using **React Router v7 in data mode** (`createBrowserRouter` + `RouterProvider`, not the framework Vite plugin), with **Elysia Eden Treaty** as the typed RPC client and **Zustand** as the bridge between the imperative game (Pixi/bitecs/WebSocket) and React-rendered chrome.

This phase is the foundation for Phase 2 (atlas tool). On its own it changes the shell of the client without altering the game.

## Non-goals

- The atlas tool itself — `/atlas` is a placeholder.
- Server-side rendering.
- Migrating the WebSocket protocol from raw binary frames to Eden subscribe.
- Replacing lil-gui.

## Architecture

### Routes

Three routes, configured via `createBrowserRouter`:

```ts
createBrowserRouter([
  { path: "/", Component: Game, loader: gameLoader },
  { path: "/login", Component: Login, loader: loginLoader },
  { path: "/atlas", Component: AtlasPlaceholder, loader: atlasLoader },
]);
```

- `gameLoader`: calls `eden.auth.me.get()`. On 401, `throw redirect("/login?error=...")`. Otherwise returns `{ user }`.
- `loginLoader`: if a session is already active (via the same eden call), `throw redirect("/")`. Otherwise returns `{ error }` from URL search params.
- `atlasLoader`: ensures `user.isAdmin === true`, otherwise redirects to `/`. Returns `{ user }`.

Auth gating lives at the loader level — the React Router idiom — rather than in component-level effects. Loaders also benefit from RR's automatic data revalidation on navigation.

### Eden Treaty

`packages/burger-client/src/eden.ts`:

```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "burger-server";

export const eden = treaty<App>(window.location.origin);
```

The client imports a type-only reference to the server's Elysia `App`. Vite erases type imports at compile time, so the server's runtime modules (`bun:sqlite`, etc.) never reach the browser bundle. If `import type { App } from "burger-server"` doesn't resolve cleanly through Vite/TS, fallback options are documented under "Open Risks" below.

Eden gives us calls like:

```ts
const { data, error } = await eden.auth.me.get();
const { data: catalog } = await eden.api.catalog.get();
```

These return `{ data, error }` — easy to use from RR loaders.

### Server-side App type export

The server's Elysia chain is currently constructed inside `createServer()` in `network.server.ts`. To expose the type, we lift the chain into a new module:

`packages/burger-server/src/app.ts`:

```ts
import { Elysia } from "elysia";
// ...

export const buildApp = (deps: AppDeps) =>
  new Elysia()
    .use(staticPlugin(...))
    .use(authRoutes({ db: deps.db, config: deps.authConfig }))
    .get("/", () => ...)
    .get("/api/atlas", () => deps.world.typeIdToAtlasSrc)
    .get("/api/catalog", () =>
      deps.db
        .query("SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id")
        .all()
    )
    .ws("/ws", {
      open(ws) { /* existing logic */ },
      close(ws) { /* existing logic */ },
      message(ws, message) { /* existing logic */ },
    });

export type App = ReturnType<typeof buildApp>;
```

`createServer` becomes a thin wrapper:

```ts
export const createServer = (deps: AppDeps & { port: number }) =>
  buildApp(deps).listen(deps.port);
```

`packages/burger-server/src/index.ts` (new) re-exports the type so `burger-client` can `import type { App } from "burger-server"`:

```ts
export type { App } from "./app";
```

Update `packages/burger-server/package.json` to declare the export so workspace consumers can find it. (The package's `main` already is `./src/index.ts` style based on burger-shared's pattern; we just need a typed entry.)

### Zustand store

`packages/burger-client/src/store.ts`:

```ts
import { create } from "zustand";
import type { Me } from "./types";
import type { CatalogEntry } from "./game/types";

type DebugMetrics = {
  tickrate: number;
  lag: number;
  updatesHz: number;
  bytesSentPerSec: number;
  bytesReceivedPerSec: number;
};

type GameStore = {
  user: Me | null;
  editor: {
    active: boolean;
    selectedTileId: number;
    catalog: CatalogEntry[];
  } | null;
  metrics: DebugMetrics;

  setUser: (u: Me | null) => void;
  setEditor: (e: GameStore["editor"]) => void;
  setEditorActive: (active: boolean) => void;
  setSelectedTileId: (id: number) => void;
  setMetrics: (m: Partial<DebugMetrics>) => void;
};

export const useGameStore = create<GameStore>((set) => ({
  user: null,
  editor: null,
  metrics: {
    tickrate: 0,
    lag: 0,
    updatesHz: 0,
    bytesSentPerSec: 0,
    bytesReceivedPerSec: 0,
  },

  setUser: (user) => set({ user }),
  setEditor: (editor) => set({ editor }),
  setEditorActive: (active) =>
    set((s) => (s.editor ? { editor: { ...s.editor, active } } : s)),
  setSelectedTileId: (id) =>
    set((s) =>
      s.editor ? { editor: { ...s.editor, selectedTileId: id } } : s,
    ),
  setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),
}));
```

The imperative game code calls `useGameStore.setState(...)` (or the helper setters) directly outside React. React components read with `useGameStore(s => s.metrics)`.

### `<Game />` component

```tsx
import { useEffect, useRef } from "react";
import { useLoaderData } from "react-router";
import { startGame } from "../game";
import { useGameStore } from "../store";

const Game = () => {
  const { user } = useLoaderData() as { user: Me };
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    useGameStore.getState().setUser(user);
    const stop = startGame(canvasRef.current, user);
    return () => stop();
  }, [user]);

  return <div ref={canvasRef} className="game-root" />;
};

export default Game;
```

The component is intentionally minimal: it owns nothing about the game. `startGame()` returns a cleanup. The Pixi canvas is appended into the ref div.

### `startGame()` shape

`packages/burger-client/src/game/index.ts` (renamed from `client.ts`) exports a single function:

```ts
export const startGame = (parent: HTMLDivElement, user: Me): (() => void) => {
  // existing setupRenderer logic — but appendChild to `parent` instead of document.body
  // existing setupSocket logic
  // existing observers, ticker.add
  // call into store: useGameStore.getState().setMetrics(...) on every metric tick
  // return a cleanup that:
  //   - app.destroy(true)
  //   - socket.close()
  //   - cancels any setIntervals / requestAnimationFrames
};
```

The internals stay basically as-is. The diff against the current `client.ts` is mostly:

- Wrap the top-level setup in a `startGame` function with parent/user params.
- Remove the global module-level world creation (move it inside `startGame`).
- Append the canvas to `parent` instead of `document.body`.
- Update `metricsSystem` to also call `useGameStore.getState().setMetrics({ ... })`.
- Add cleanup logic at the end.

### `<Login />` component

Replaces the imperative `renderSignInScreen` from the old `auth.client.ts`. Plain JSX:

```tsx
import { useLoaderData, Link } from "react-router";

const Login = () => {
  const { error } = useLoaderData() as { error: string | null };
  return (
    <div className="login-screen">
      <h1>burger</h1>
      {error && <p className="error">error: {error}</p>}
      <a href="/auth/4orm" className="button">
        sign in with 4orm
      </a>
    </div>
  );
};
```

`<a href>` (not `<Link>`) because `/auth/4orm` is a server-side redirect, not a client-side route.

### `<AtlasPlaceholder />`

Trivial:

```tsx
const AtlasPlaceholder = () => (
  <div className="atlas-placeholder">
    <h1>atlas</h1>
    <p>coming soon (phase 2)</p>
    <a href="/">back to game</a>
  </div>
);
```

### lil-gui

Stays. The debug GUI is created inside `startGame()` as today, and is wired to `useGameStore` so its values reflect store state. Sign-out button calls a function that hits `eden.auth.logout.post()` then navigates to `/login` via `window.location.href = "/"` (or the loader will redirect). Cosmetic only — not on this PR's critical path.

### Files

| Path                                           | Action                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/burger-client/index.html`            | Add `<div id="root"></div>`, change script src to `/src/main.tsx`                                                                                                                                    |
| `packages/burger-client/src/main.tsx`          | NEW. `<RouterProvider router={router} />` mount                                                                                                                                                      |
| `packages/burger-client/src/router.ts`         | NEW. Route tree + loaders                                                                                                                                                                            |
| `packages/burger-client/src/eden.ts`           | NEW. Typed Eden Treaty client                                                                                                                                                                        |
| `packages/burger-client/src/store.ts`          | NEW. Zustand store                                                                                                                                                                                   |
| `packages/burger-client/src/types.ts`          | NEW (or move from `auth.client.ts`). `Me` type + shared client types                                                                                                                                 |
| `packages/burger-client/src/routes/Game.tsx`   | NEW. Game route component                                                                                                                                                                            |
| `packages/burger-client/src/routes/Login.tsx`  | NEW. Sign-in screen                                                                                                                                                                                  |
| `packages/burger-client/src/routes/Atlas.tsx`  | NEW. Placeholder                                                                                                                                                                                     |
| `packages/burger-client/src/game/index.ts`     | RENAMED from `src/client.ts`. Exports `startGame()`                                                                                                                                                  |
| `packages/burger-client/src/game/network.ts`   | RENAMED from `src/network.client.ts`                                                                                                                                                                 |
| `packages/burger-client/src/game/editor.ts`    | RENAMED from `src/editor.client.ts`                                                                                                                                                                  |
| `packages/burger-client/src/game/consts.ts`    | RENAMED from `src/consts.client.ts`                                                                                                                                                                  |
| `packages/burger-client/src/auth.client.ts`    | DELETED. `Me` type → `types.ts`. Sign-in screen → `<Login/>`                                                                                                                                         |
| `packages/burger-client/src/style.css`         | Add styles for `.login-screen`, `.atlas-placeholder`, `.game-root`                                                                                                                                   |
| `packages/burger-client/vite.config.ts`        | Add `@vitejs/plugin-react`                                                                                                                                                                           |
| `packages/burger-client/package.json`          | Add deps: `react`, `react-dom`, `react-router`, `@elysiajs/eden`, `zustand`. devDep: `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`                                                      |
| `packages/burger-client/tsconfig.json`         | Add `"jsx": "react-jsx"` (it's not currently set; existing config is fine for non-JSX)                                                                                                               |
| `packages/burger-server/src/app.ts`            | NEW. `buildApp` and `App` type                                                                                                                                                                       |
| `packages/burger-server/src/network.server.ts` | Lift app construction into `app.ts`. `createServer` becomes a thin listen-wrapper                                                                                                                    |
| `packages/burger-server/src/index.ts`          | NEW. `export type { App } from "./app"`                                                                                                                                                              |
| `packages/burger-server/package.json`          | Add `"main": "./src/index.ts"`, `"types": "./src/index.ts"`, `"exports": { ".": "./src/index.ts" }` to match burger-shared's pattern, so `import type { App } from "burger-server"` resolves cleanly |

The internal helpers exported from `network.server.ts` for the server tick (`processPlayerInputs`, `broadcastGameState`, `markEntityDirty`, `resetPaintCounters`, `getPlayerConnections`) keep working — they're independent of the app construction.

### Build + dev workflow

`pnpm dev` is unchanged: vite proxies `/auth`, `/api`, `/ws` to the elysia server on `:5000`. The browser sees `:5173`, vite serves the React app. The `@vitejs/plugin-react` plugin handles JSX/TSX.

`pnpm build-frontend` works the same — it produces a static SPA in `dist/`. The output is still a single index.html + bundled JS; there's no SSR step.

In production, the Elysia server serves `./public/index.html` for `/` and the prod build artifacts via `staticPlugin`. React Router's `createBrowserRouter` handles client-side routing; the server only ever serves the index.html for non-asset paths. **A small server change** is needed: `app.get("/", () => file("./public/index.html"))` should also catch nested routes like `/login` and `/atlas` so the SPA can route them. Either:

- (a) Add `app.get("/login", ...)` and `app.get("/atlas", ...)` explicitly.
- (b) Use a fallback route for any non-API/non-static path.

Pick (a) for explicitness in this phase. Phase 2 may need a smarter fallback if more routes appear.

## Tests

The existing 75 server tests should pass unchanged — server logic is unaffected by the refactor (the chain moves modules but the routes stay identical). Verify with the existing test suite.

No new tests for the React shell in this phase. The wrapper components are thin enough that running `pnpm dev` and clicking through is sufficient verification.

The full smoke checklist:

- `pnpm install` (with new deps).
- `pnpm typecheck` clean across all 3 packages.
- `pnpm lint` clean.
- `pnpm fmt:check` clean.
- `pnpm test` — 75 server + 13 shared tests pass.
- `pnpm build-frontend` produces a working bundle.
- `pnpm dev` starts cleanly. Manual smoke:
  - Visit `/` while logged out → see `/login` (after redirect).
  - Click sign-in → 4orm OAuth → land back on `/` with the game running.
  - Visit `/atlas` as admin → see placeholder. As non-admin → redirected to `/`.
  - Game functions identically: prediction, reconciliation, paint, palette, debug GUI.

## Open risks

1. **`import type { App } from "burger-server"` may not resolve cleanly through Vite + TS.** Server has runtime imports (`bun:sqlite`, native node bits) that the browser can't load. Type-only imports erase at compile time, so this _should_ work, but Vite's resolver may try to walk the source. Mitigations in order of preference:
   - (a) Add a separate type-only entry `packages/burger-server/src/types.ts` that re-exports just `type App` and avoids importing `bun:sqlite`-touching files at the top level. Configure burger-server's `package.json` exports field with a `./types` entry.
   - (b) Run `tsc --emitDeclarationOnly` on burger-server in CI, ship the `.d.ts` files in a `dist/` directory, point burger-client's import there.
   - (c) Hand-write a minimal `App` type in burger-client that mirrors only the routes the client uses. Worst case; defeats Eden's purpose.

   Plan to try (a) first and document fallback during implementation.

2. **`createServer` refactor is a load-bearing change.** All 75 server tests use it. Lifting the app construction into `buildApp` shouldn't change behavior, but the test file's `createServer` calls need verification. The plan keeps the function signature stable.

3. **Pixi mount inside React is occasionally tricky** — React's StrictMode double-mounts effects in dev, which calls `startGame` twice and the cleanup once. The `startGame` function MUST handle being called twice without leaks. Verify: the second `startGame` should produce the same state as the first; the cleanup must fully tear down (especially the WebSocket and the Pixi ticker). React 19's StrictMode in dev forces this discipline; honoring it now means production is clean too.

4. **Loader caching during navigation.** RR may try to revalidate `gameLoader` when navigating between `/` and `/atlas`. That re-mounts the `<Game/>` component, which re-runs the `useEffect` cleanup + setup — restarting the WebSocket and Pixi app every time. To prevent: use `shouldRevalidate: () => false` on the game route's loader, or only revalidate when the auth user changes. Document during implementation.

## Branch & commit plan

Branch: `client-react-router-eden`

Suggested commit sequence (each independently green: typecheck + tests pass):

1. `chore: lift Elysia app construction to app.ts; export App type`
2. `chore: add react, react-router, eden, zustand client deps`
3. `feat(client): wrap game in startGame() function (no behavior change)`
4. `feat(client): React Router data mode shell (/, /login, /atlas)`
5. `feat(client): zustand store; route metrics + user through it`
6. `chore: drop auth.client.ts; <Login/> replaces renderSignInScreen`
7. `chore(server): explicit /login and /atlas SPA fallback routes`

PR title: `Convert client to React Router v7 + Eden + Zustand (phase 1 of atlas tool)`

## Phase 2 preview

After this lands, Phase 2 builds the actual atlas tool at `/atlas`:

- A grid view of `atlas.png` with 32×32 cells and per-cell catalog metadata.
- Click a cell to see/edit its catalog entry (id, type, label).
- "Save" calls `eden.api.catalog.put()` (or similar), server writes back to `atlas.toml`.
- Dev-only gating for the route (production hides it).
- Catalog changes are picked up on next server restart (atlas.toml is the source of truth, synced to `tile_catalog` on boot).
