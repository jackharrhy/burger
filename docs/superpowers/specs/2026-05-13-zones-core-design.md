# Zones Core — Design

Date: 2026-05-13
Status: Approved (pending user review of written spec)

## Overview

Add a server-authoritative concept of **zones**: free-form sets of tile cells that gate non-admin paint authorization. Admins create zones, assign users to them, and paint zone shapes with a new admin-only paint mode. Non-admin paint is server-rejected unless the target cell is inside a zone the user is a member of. Admins bypass the check.

This is the **first of three** specs for the larger "player paint" feature. This spec covers:

- Zone data model
- Server-side authorization (`canPaint`)
- Admin REST API for zone CRUD + cell/member mutation
- Admin UI: `<ZonesWindow>` and zone-paint mode
- WS message for shipping per-user paintable-cell sets

Out of scope (deferred to subsequent specs):

- Non-admin paint UI (red cursor tint, palette while in zone, per-user spawn) — **player-paint-UX spec**
- Status bar / player-side palette configuration — **status-bar spec**

## Goals

- Admins can carve out free-form regions of the world and assign them to users.
- Non-admin paint commands are rejected server-side outside of granted zones.
- Per-user paintable-cell set is delivered over WS so future client UX can render feedback without server round-trips.
- Existing admin paint flow is unaffected (admins still bypass all checks).

## Non-Goals

- Player UX for painting inside zones (next spec).
- Sharing zones across multiple owners with role distinctions (e.g. owner vs. contributor) — the data model supports many-to-many membership, but the v1 UI treats every member as equally authorized.
- Per-zone palettes or per-zone tile catalogs.
- Zone history / undo of admin edits.

## Data Model

Three new tables. All migrations are additive (`CREATE TABLE IF NOT EXISTS`); existing prod DB requires no manual intervention.

```sql
CREATE TABLE zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE zone_cells (
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  PRIMARY KEY (zone_id, x, y)
);
CREATE INDEX zone_cells_xy ON zone_cells(x, y);

CREATE TABLE zone_members (
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (zone_id, user_id)
);
CREATE INDEX zone_members_user ON zone_members(user_id);
```

**Coordinate convention**: `(x, y)` are tile-cell *centers* in pixel space — identical to the existing `tiles` table and `validatePaint`. With `TILE_SIZE = 32`, valid x values are 16, 48, 80, … Reusing this convention lets cell-set checks compare keys directly against `world.tilesAtPosition` keys (also `"x,y"` strings of centers).

### In-Memory Representation

On `world`:

- `world.zones: Map<zoneId, ZoneRuntime>` where `ZoneRuntime = { id: number; name: string; cells: Set<string>; members: Set<string> }`. Cell-set keys are `"x,y"` strings of tile-cell centers.
- `world.cellToZone: Map<string, number>` — reverse index for "which zone owns this cell?" Used in the paint authorization hot path.

Both maps are populated at boot from the three tables (`loadZones(db, world)` called from `loadWorld`). Mutations write the DB inside a single transaction, then mirror to the in-memory maps synchronously after commit. Bun's single-threaded event loop guarantees no interleaving between DB commit and map update.

## Server Authorization

A single pure function lives in `packages/burger-server/src/world.ts`:

```ts
export const canPaint = (
  world: World,
  userId: string,
  x: number,
  y: number,
  isAdmin: boolean,
): boolean => {
  if (isAdmin) return true;
  const zoneId = world.cellToZone.get(`${x},${y}`);
  if (zoneId === undefined) return false;
  const zone = world.zones.get(zoneId);
  return zone?.members.has(userId) ?? false;
};
```

Wired into the paint message handler in `network.server.ts`:

1. JSON decode.
2. `validatePaint(raw, world, catalogIds)` → `ValidatedPaint | null`.
3. If null, drop.
4. `canPaint(world, userId, cmd.x, cmd.y, isAdmin)` → boolean.
5. If false, drop silently and log at info level: `paint_denied user=… x=… y=…`.
6. `applyPaint(world, db, cmd, userId)`.

**Cells with no assigned zone**: only admins can paint them. Non-admin paint anywhere outside their granted zone(s) — including unzoned cells — is rejected. This gives admins a "world is locked down by default" posture.

## REST API

All endpoints admin-gated via existing `requireAdmin` helper.

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/zones` | — | `{ zones: [{ id, name, member_user_ids: string[], cell_count: number }] }` | List for the assignment UI. Does not ship cells. |
| POST | `/api/zones` | `{ name: string }` | `{ id, name }` | 409 if name taken. |
| PATCH | `/api/zones/:id` | `{ name: string }` | `{ id, name }` | Rename. 409 on duplicate. |
| DELETE | `/api/zones/:id` | — | `{ ok: true }` | Cascades to cells + members. Tiles in `tiles` table are untouched. |
| PUT | `/api/zones/:id/cells` | `{ add: [[x,y]...], remove: [[x,y]...] }` | `{ added: number, removed: number, dropped: number }` | Bulk diff. Invalid entries dropped silently; `dropped` count returned. |
| PUT | `/api/zones/:id/members` | `{ user_ids: string[] }` | `{ member_user_ids: string[], dropped: number }` | Replace membership entirely. `dropped` counts unknown user IDs that were silently ignored. |
| GET | `/api/zones/all-cells` | — | `{ zones: [{ id, cells: [[x,y]...] }] }` | Lazy-loaded by the admin painter on demand. Separate from list to avoid bloat. |

### Cell Overlap Semantics

When an admin adds cell `(x, y)` to zone A but the cell is already in zone B, **last-write-wins**: the cell moves from B to A. A server log line at info level records the overlap (`zone_cell_reassigned cell=… from_zone=B to_zone=A`). The painter UI shows all zones at reduced opacity, so the admin can visually see what they're overwriting. v1 does not block or warn; we can layer a confirmation flow on top later if it becomes a problem in practice.

### Validation

- Zone names: trimmed; length 1–32 chars; unique across non-deleted zones.
- Cells: each `[x, y]` must be integer, cell-center-aligned (same checks as `validatePaint`), and inside `world.bounds`. Invalid entries dropped silently.
- Member user IDs: must exist in `users` table. Unknown IDs are dropped silently. The members PUT response is `{ member_user_ids: string[], dropped: number }` — the `dropped` count lets the client surface a warning if needed.

### Transactions

The cells PUT and members PUT each wrap their inserts/deletes in a single SQLite transaction. The in-memory `world.zones` and `world.cellToZone` are updated *after* the transaction commits.

## WebSocket Protocol

Two new server→client message types. No new client→server messages — zone mutation is REST-only.

### `zones_updated` (admin only)

```json
{ "type": "zones_updated" }
```

Sent to all connected admin clients on any zone mutation. Admin clients respond by re-fetching `/api/zones` + `/api/zones/all-cells`. Simple and slightly wasteful; admins are 1–2 in practice, so the cost is negligible. Diff-based updates are a possible future optimization.

### `my_zones` (non-admin only)

```json
{ "type": "my_zones", "cells": [[16, 16], [16, 48], ...] }
```

Sent to a specific user when their effective paintable-cell set changes:

- On WS connect: initial state (union of all cells across all zones the user is a member of).
- On `zone_members` mutation affecting this user.
- On `zone_cells` mutation in any zone this user belongs to.

Admins do not receive `my_zones` — they bypass the check, the data is unused.

Worst case the payload is the full 64×64 grid (~4096 cells, ~40 KB JSON). Sent rarely, so JSON is fine for v1. If pathological, we can move to a binary RLE.

## Admin UI

### Zones Window

New entry in the window-manager taskbar, alongside Atlas / Spawn / Bots. Admin-only (taskbar already gates by `user.isAdmin`).

Contents:

- **Zone list**: table of `{ name, cell_count, members }` with click-to-select. Each zone gets a deterministic color from `hsl((id * 137.5) % 360, 60%, 50%)` (golden-angle distribution).
- **"New zone" button**: prompts for a name → `POST /api/zones`.
- **Selected-zone detail panel**:
  - Rename input (controlled, submits on blur or Enter → `PATCH /api/zones/:id`).
  - Members multi-select. Fetches `/api/users` (new admin-only endpoint returning `{ id, display_name }[]`). On submit → `PUT /api/zones/:id/members`.
  - "Enter zone-paint mode" button. Opening the Zones window does NOT auto-enter zone-paint mode — the admin enters it explicitly via the button or the `z` hotkey, so opening the window to inspect zone membership doesn't accidentally hijack their tile-paint session.
  - "Delete zone" button with `confirm()` dialog → `DELETE /api/zones/:id`.

### Zone-Paint Mode

A second paint mode parallel to tile-paint. Mutually exclusive: entering zone-paint exits tile-paint and vice versa.

- **Toggle key**: `z`. Tile-paint key remains `e`.
- **Selected zone**: from the Zones window's selected zone. Hotkeys 1–9 jump to zones #1..#9 (by id order). Mouse wheel cycles selection.
- **Rendering**: a `Graphics` overlay below the cursor sprite. Selected zone cells drawn at 50% opacity in the zone's color; other zones at 20% opacity. Redrawn only on zone change (not per-frame).
- **Input**:
  - Left-click + drag: cells added to a pending stroke.
  - Right-click + drag: cells added to a pending erase stroke.
  - On mouseup: send accumulated `{ add, remove }` arrays to `PUT /api/zones/:id/cells`. Optimistic update: the overlay refreshes immediately on mouseup; reconciles when the server's `zones_updated` arrives.
- **Mode exit**: pressing `z` again, pressing `e` (switches to tile-paint), or closing the Zones window.
- **Input guards**: same as tile-paint — `elementFromPoint === canvas`, ignore keydown when target is `INPUT`/`TEXTAREA`/contenteditable.

### Color Assignment

Zone color = `hsl((id * 137.5) % 360, 60%, 50%)`. Stable across reloads (id is stable). For up to ~20 zones, hues are visually distinct. Beyond that, hue distinction degrades — acceptable for v1.

## Testing Strategy

### Unit Tests (pure, no DB or WS)

- `canPaint`: admin always true; non-admin member-of-zone-containing-cell true; non-admin non-member false; cell-in-no-zone + non-admin false; missing zone (deleted mid-check) false.
- Cell diff validator: integer/cell-center/in-bounds enforcement; invalid entries dropped; counts returned.
- Zone name validator: length 1–32; trim; reject empty; reject duplicate (DB-level, tested in integration).

### DB Integration Tests (in-memory SQLite)

- Create zone → row exists; empty cells + members.
- Cell PUT add/remove → rows match; overlap reassigns cell, old zone loses it, log line emitted.
- Member PUT replace → membership matches; idempotent on no-op.
- Delete zone → cascades to `zone_cells`, `zone_members`; `tiles` untouched.
- Rename to existing name → 409.

### HTTP Integration Tests

- Each endpoint returns 401/403 without admin session.
- Non-admin GET `/api/zones` → 403.
- Full create→cells→members→get roundtrip reflects state.

### WS Integration Tests (real Elysia)

- Non-admin paint at cell not in their zone → no broadcast, DB unchanged.
- Non-admin paint at cell in their zone → broadcast happens, DB updated.
- Admin paint anywhere (in zone, outside zone, in someone else's zone) → always works.
- Member add via REST → target user receives `my_zones` over WS.
- Cell add/remove via REST → existing members receive `my_zones` update.
- Admin connect → never receives `my_zones`.

### Manual Smoke

Two browsers post-deploy:

- Admin creates "test-zone", paints a few cells.
- Admin assigns a non-admin user.
- Non-admin connects, sees nothing in UI yet (this spec ships no non-admin UI).
- Admin verifies via `tile_edits` log that non-admin paint commands are silently dropped outside zone, succeed inside.

No client unit tests in this spec — admin painter is UX-heavy and tested manually. Client unit tests show up in the next spec where the player cursor-tint logic is pure enough to test.

## Migration & Rollout

### DB Migration

Three `CREATE TABLE IF NOT EXISTS` statements added to `runMigrations` in `packages/burger-server/src/db.ts`. Two indexes (`zone_cells_xy`, `zone_members_user`). Additive only; existing prod DB requires no destructive change.

### Boot Sequence

`loadWorld` gains a step after settings load:

```ts
loadZones(db, world);  // populates world.zones, world.cellToZone
```

Zero-row state (no zones) boots cleanly: maps are empty, `canPaint` returns true only for admins.

### Backwards Compatibility

- Existing non-admin players cannot paint today (no client UI). After this spec ships, they still can't paint via UI. Server is ready; next spec wires the UI.
- Admin paint flow unchanged. `canPaint` short-circuits on admin.

### Feature Flag

Not needed. New code paths are guarded by admin status or zone membership; an empty zones table preserves the current behavior exactly.

### Rollout Order

1. Migrations + `loadZones` + `canPaint` wiring. Deploys harmlessly.
2. REST endpoints + WS broadcasts. Admins can curl-create zones; no UI yet.
3. Zones window + zone-paint mode. Full admin experience.

Each step is independently deployable. A UI bug in step 3 can be reverted without server impact.

### Observability

Info-level log lines:

- `zone_created id=… name=… by=…`
- `zone_deleted id=… name=…`
- `zone_renamed id=… old_name=… new_name=…`
- `zone_member_added zone_id=… user_id=…`
- `zone_member_removed zone_id=… user_id=…`
- `zone_cell_reassigned cell=… from_zone=… to_zone=…`
- `paint_denied user=… x=… y=…`

The `paint_denied` line will be useful for debugging "why can't I paint here?" reports.

## Future Work (out of scope)

- **player-paint-UX spec** (next): non-admin cursor-tint, in-zone paint mode, per-user spawn override.
- **status-bar spec** (after that): HUD area, player-side palette configuration.
- Possible additions, deferred until requested by use case: per-zone palette restrictions, zone roles (owner vs. contributor), zone history / undo, sharing/cloning zone shapes.

## Open Questions

None. All design decisions resolved during brainstorm. Implementation plan will surface any details that surface as ambiguous in code.
