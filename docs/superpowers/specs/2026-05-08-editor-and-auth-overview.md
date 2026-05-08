# Editor & Auth — Overview

Status: approved
Date: 2026-05-08
Branch: `editor-and-auth`

## What

Add an in-game tile editor for admins. Replace the static LDtk level with a SQLite-backed tile store. Gate WebSocket connections behind 4orm OAuth so we know who's playing and who's allowed to edit.

## Sub-projects

This is one feature delivered as three independently-mergeable PRs in sequence. Each has its own design doc:

1. **PR A — Auth.** [`2026-05-08-pr-a-auth-design.md`](./2026-05-08-pr-a-auth-design.md). Adds 4orm OAuth integration to burger-server. SQLite is introduced for users + sessions tables. All WS connections must authenticate; bots are unaffected. Game still uses LDtk for tiles.
2. **PR B — SQLite tile store.** [`2026-05-08-pr-b-sqlite-tiles-design.md`](./2026-05-08-pr-b-sqlite-tiles-design.md). Adds tile_catalog, tiles, tile_edits, settings tables. Loads atlas.toml as the catalog source of truth. One-time import script ports the existing burger.json into the DB. LDtk parser is deleted. World bounds become a hard wall.
3. **PR C — Editor.** [`2026-05-08-pr-c-editor-design.md`](./2026-05-08-pr-c-editor-design.md). Adds the in-game paint UX: edit-mode toggle, palette hotbar, click-to-paint. New PAINT message type, server-side validation + admin gate + rate limit. Paints persist via the tile store from PR B.

Each PR is shippable on its own. PR A is shippable even if B and C never land. PR B is shippable even if C never lands.

## Non-goals

- Anonymous play. Auth is required.
- Editing the catalog in-game. `atlas.toml` is source-controlled.
- Multi-tile paint (rectangles, fills, line-tools). Single-tile paint only.
- In-game spawn zone editor (deferred; settings.spawn_x/y/w/h is edited via DB for now).
- Client-side paint prediction (server is authoritative; ~17ms latency is fine for placement).
- Per-edit attribution UI (the `tile_edits` log makes it possible later).
- Undo/redo UI.
- Multiple worlds, multiple maps. One world per server instance.

## High-level architecture

After all three PRs land:

- `packages/burger-server/data/burger.db` (gitignored, mounted as a volume in compose) holds users, sessions, tile_catalog, tiles, tile_edits, settings.
- `packages/burger-server/atlas.toml` (committed) is the canonical tile catalog. Server syncs to `tile_catalog` on every boot.
- `packages/burger-server/src/auth/` holds OAuth + sessions + Elysia routes.
- `packages/burger-server/src/db.ts` opens the SQLite connection, runs `CREATE TABLE IF NOT EXISTS` migrations.
- `packages/burger-server/src/world.ts` replaces level.ts: loads the catalog, loads tiles, builds bitECS entities, exposes world bounds.
- `packages/burger-server/src/paint.ts` handles paint messages.
- `packages/burger-client/src/auth.client.ts` handles `/auth/me` check and the "sign in with 4orm" flow.
- `packages/burger-client/src/editor.client.ts` handles edit mode, cursor preview, palette UI.

## Risks

- **OAuth integration is stateful and async.** Nothing in the current burger codebase uses cookies, sessions, or external HTTP calls. PR A introduces these patterns; getting them right (PKCE state cookie, session cookie security flags, redirect URL handling for both prod and localhost) is the most error-prone work in this project.
- **4orm config change.** Adding `[clients.burger]` to `oauth2_clients.toml` in the 4orm repo is a separate manual step the maintainer must do before PR A can be deployed.
- **Tile import.** The one-time LDtk → SQLite import is destructive (after the import, level.ts is deleted). Running the import on the wrong DB or with a stale burger.json could bake in a bad world state. Mitigation: import is idempotent (UPSERT semantics) and runs against the configured DB_PATH; instructions in the PR B doc.
- **Movement bounds change feel.** Today players can walk anywhere their character moves to. After PR B, there's a hard wall at the world edge. Worth verifying the default 64×64 is generous enough.
- **Observer serializer broadcasting tile changes.** PR C relies on bitECS's existing observer pattern for tile updates to reach clients. This already works for player add/remove, but tile changes during gameplay are a new pattern. Worth a smoke test on PR C.

## What persists across PRs

- The SQLite file (introduced in PR A) is shared across all phases. Migrations are append-only `CREATE TABLE IF NOT EXISTS`, so PR B and C just add tables without touching PR A's data.
- The TODO.md quirks (myEid race, random freezes, disconnect bugs, entity recycling) remain out of scope. The new auth/editor work shouldn't make them worse, and the test suite covers the netcode invariants.
