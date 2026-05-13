# Player Paint UX — Design

Date: 2026-05-13
Status: Approved (pending user review of written spec)

## Overview

Build the non-admin paint experience on top of the zones-core authorization layer (PR #13). When a non-admin has at least one assigned zone, they can enter paint mode (`e`), see a faint outline of their zone's perimeter, paint tiles inside it with the same 9-slot palette UX as admins, and curate their personal palette via a new Tile Picker window opened from a single-button HUD.

This is the **second of three** specs for the larger player-paint feature:

- ✅ **zones-core** (PR #13) — data model, server authorization, admin painter
- 🟢 **player-paint-UX** (this spec) — non-admin paint, cursor-tint, zone-perimeter overlay, Tile Picker, mini HUD
- ⏳ **status-bar** (next) — full HUD with player status info

## Goals

- Non-admins can paint inside zones they're members of, using the same paint mode as admins.
- Cursor tints red over forbidden cells; the user knows visually before they click.
- A faint perimeter outline shows the boundary of the user's zone(s) while paint mode is active.
- Non-admins curate their personal 9-slot palette via a Tile Picker window listing all catalog tiles.
- A minimal one-button HUD lets the user open the Tile Picker. Visible only when they have a zone.
- Paint mode auto-exits if the user loses all their zones mid-session.

## Non-Goals

- Per-user spawn point within zone — deferred to a v2 follow-up. Players continue to spawn at the global spawn zone.
- Full status bar with health / score / etc. — deferred to status-bar spec.
- Per-zone palette restrictions (admin saying "only walls in this zone"). The catalog is fully open to all non-admin painters; zone gating is purely geometric.
- Multi-zone painters needing to "pick which zone they're painting in." The check is per-cell; cells are owned by exactly one zone at a time, and the user is either a member of that zone or not. The user doesn't need to choose.

## Entry & Exit

**Entering paint mode**:

- `e` or `Tab` keypress, same as admin today.
- Gating: a new function `canEnterPaintMode(user, myZoneCells)` returns `true` if `user.isAdmin`, otherwise `true` iff `myZoneCells.size > 0`.
- If the gate returns `false`, the keypress is a no-op. No banner, no toast — silent.

**Exiting paint mode**:

- `e` or `Tab` again — toggles off (existing behavior).
- `Escape` — explicit exit (new; works for both admin and non-admin, since it's a generally useful keybinding to add anyway).
- **Automatic exit on zone loss**: a `MY_ZONES` WS message arrives with `cells.length === 0`. The client compares against its prior `myZoneCells.size`. If it transitioned non-empty → empty AND paint mode is currently active for a non-admin, the client calls the same exit-paint-mode code path as a keypress would. Cursor sprite, palette strip, and zone perimeter all disappear. Re-entry is blocked by the gate until a future `MY_ZONES` brings `cells.length > 0`.

The transition logic lives in the existing `useGameStore` subscription that already handles `MY_ZONES` (Task 9 of zones-core). We add a side-effect that runs after `setMyZoneCells`: if the new set is empty and editor's `state.active` is true and user is non-admin, dispatch the exit.

## Cursor Visual Feedback

The existing cursor sprite shows the currently-selected palette tile. When the cursor is over a cell that the user is NOT authorized to paint, two changes:

1. The cursor sprite's `tint` property is set to `0xff4040` (a saturated red), applied via pixi's built-in `Sprite.tint` (multiplicative blend).
2. The cursor's 1px outline rect (currently white `0xffffff`) is redrawn with red `0xff4040`.

When the cursor returns to an allowed cell, both revert to the originals (`0xffffff` tint, white outline).

**Authorization check on the client**:

```ts
const canPaintCell = (user, myZoneCells, key) =>
  user.isAdmin || myZoneCells.has(key);
```

Cheap: a single Set lookup per cursor move. The existing cursor-update tick (in `updateEditor`) gains this check and toggles the tint/outline accordingly.

**Important nuance**: when in paint mode, the cursor follows the mouse to the nearest cell center. The `key` is `${cursorX},${cursorY}`. Same key shape as `myZoneCells` (already a `Set<"x,y">` after Task 9's `setMyZoneCells` conversion).

Admins are unaffected — `user.isAdmin` short-circuits `canPaintCell` to `true`, cursor stays white.

## Zone Perimeter Overlay

While paint mode is active for a non-admin, render a faint outline around the union of their zone cells. The outline is the **perimeter** of the cell set, not per-cell borders.

**Computing the perimeter**:

For each cell `(x, y)` in `myZoneCells`, check its 4 cardinal neighbors. For each neighbor `(nx, ny)` that is NOT in `myZoneCells`, draw the edge segment between the cell and the neighbor. The collection of these segments forms the perimeter.

Pseudocode:

```ts
const drawPerimeter = (cells: Set<string>, g: Graphics) => {
  g.clear();
  const halfTile = TILE_SIZE / 2;
  for (const key of cells) {
    const [x, y] = key.split(",").map(Number);
    // North edge: if (x, y - TILE_SIZE) is not in cells, draw top edge.
    if (!cells.has(`${x},${y - TILE_SIZE}`)) {
      g.moveTo(x - halfTile, y - halfTile).lineTo(x + halfTile, y - halfTile);
    }
    // South edge
    if (!cells.has(`${x},${y + TILE_SIZE}`)) {
      g.moveTo(x - halfTile, y + halfTile).lineTo(x + halfTile, y + halfTile);
    }
    // West edge
    if (!cells.has(`${x - TILE_SIZE},${y}`)) {
      g.moveTo(x - halfTile, y - halfTile).lineTo(x - halfTile, y + halfTile);
    }
    // East edge
    if (!cells.has(`${x + TILE_SIZE},${y}`)) {
      g.moveTo(x + halfTile, y - halfTile).lineTo(x + halfTile, y + halfTile);
    }
  }
  g.stroke({ color: 0xffd966, width: 2, alpha: 0.7 });
};
```

Color: a warm yellow (`#ffd966`, 70% alpha) — visible but not jarring, distinct from cursor red and admin zone fills.

**Visibility**:

- Visible only when paint mode is active for a non-admin.
- Hidden for admins (they have the full zone fill overlay via zones-core).
- Hidden when paint mode is off.
- Redrawn whenever `myZoneCells` changes (i.e., on `MY_ZONES` WS message).

**Performance**:

For a typical zone of ~50 cells, that's at most 200 neighbor checks and at most 200 line segments. Drawing is O(n) where n = cell count; negligible. Redraw only happens on `MY_ZONES` (rare) and on paint-mode toggle.

## Tile Picker Window

A new window: `<TilePickerWindow>`, registered alongside other windows in the window manager.

**Window contents**:

- A flat grid of all catalog tiles, each rendered as a thumbnail sourced from the atlas at the catalog entry's `(src_x, src_y)`.
- Below each thumbnail: the catalog `label` text.
- The 9 currently-palette-member tiles are visually marked (e.g., a yellow border around the thumbnail).
- Right-click a thumbnail to toggle its palette membership. Left-click does nothing (or could preview details — but for v1 we keep it simple: left-click is a no-op; right-click toggles).
- Layout: CSS grid, ~64x64 thumbnails, wrapping to fill the window width. Window default size 320x480 (same as Zones window).

**Data flow**:

- On open: fetch `/api/catalog` (already exists) and `/api/palette` (already exists, admin-only today — we'll widen it).
- On right-click: PUT `/api/palette` with the new ids list. The existing palette endpoint already validates "max 9", "must be in catalog", and returns 400 on violation.

**Server change required**:

Currently `GET /api/palette` and `PUT /api/palette` are admin-gated. They need to be widened to "authenticated user" — any logged-in user, admin or not, can read/write their own palette. The existing `/api/palette.ts` (`packages/burger-server/src/palette.ts`) already keys by `user_id`, so the data model is fine; just the route auth check changes.

**Access control**:

- The window is available to all authenticated users — admins via the existing taskbar, non-admins via the new HUD button.
- Tile Picker is the **only** way for non-admins to curate their palette. (Admins still have the right-click-on-atlas-grid path too.)

## Non-Admin Mini HUD

A minimal HUD region visible to non-admins, positioned in the top-left (so it doesn't conflict with the admin taskbar in the top-right).

**Contents**:

- A single button: "Palette" — opens the Tile Picker window.

**Visibility**:

- Visible iff the user is non-admin AND `myZoneCells.size > 0`.
- Hidden when the user has no zone (no point in curating a palette if they can't paint).
- Hidden for admins (they have the taskbar with Atlas, Spawn, Bots, Zones — Atlas already grants palette curation).

**Implementation**:

A small React component, `<NonAdminHud>`, rendered at the same level as `<WindowManager>` (probably in the same parent component). Pure presentational, just renders the button. Click opens the Tile Picker via the same `toggleWindow(WINDOW_TILE_PICKER)` mechanism the taskbar uses.

**Future**: when the status-bar spec lands, this HUD region grows. The Palette button stays; the rest of the bar gets populated.

## Server-Side Changes

Minimal. Two small endpoint changes:

1. `GET /api/palette` and `PUT /api/palette` — widen from admin-only to authenticated-user. The existing `requireAdmin` check is replaced with a simpler `requireUser` (a new helper, or inline session check). The body validation (max 9 ids, must be in catalog) is unchanged.

2. The existing `MY_ZONES` WS message already ships per-user paintable cells. No protocol change needed.

`canPaint` on the server is unchanged — already correctly rejects non-admin paint commands outside their zones. The whole point of this spec is to layer client UI on top of that already-correct server behavior.

## Client Architecture

**New files**:

- `packages/burger-client/src/windows/TilePickerWindow.tsx` — the catalog browser + palette toggler.
- `packages/burger-client/src/windows/NonAdminHud.tsx` — the single-button HUD.

**Modified files**:

- `packages/burger-client/src/windows/WindowManager.tsx` — register `WINDOW_TILE_PICKER`. Add to admin taskbar too (alongside Atlas/Spawn/Bots/Zones). Render `<NonAdminHud />` for non-admin sessions.
- `packages/burger-client/src/game/editor.ts` — `canEnterPaintMode` gate; `canPaintCell` check inside `updateEditor` to toggle cursor tint; expose an exit function for the auto-exit case.
- `packages/burger-client/src/game/zones-perimeter.ts` (new) — perimeter overlay state + draw function. Mirrors `zones.ts` in shape but draws perimeter strokes instead of cell fills. Parented to `mainContainer` like the admin zones overlay.
- `packages/burger-client/src/game/index.ts` — initialize the perimeter overlay; subscribe to `myZoneCells` for redraws + auto-exit; pass `myZoneCells` getter into editor for cursor tint.
- `packages/burger-client/src/store.ts` — no shape changes; the `myZoneCells` slot already exists from zones-core Task 9.

**Server files**:

- `packages/burger-server/src/app.ts` — change two palette endpoint handlers from admin-only to authenticated-user.

## Testing Strategy

**Server unit/integration**:

- HTTP: assert that a non-admin can `GET` and `PUT` their own palette (200 status, persisted correctly).
- HTTP: assert that an unauthenticated request still returns 401/403.
- HTTP: assert that a non-admin cannot somehow modify another user's palette (no body field allows targeting; sanity-check that the user_id is sourced from the session, not request body).

**Client unit** (pure functions):

- `canEnterPaintMode(user, cells)`: admin always true; non-admin true iff cells non-empty; non-admin false on empty.
- `canPaintCell(user, cells, key)`: admin true; non-admin true iff cells has key; false otherwise.
- Perimeter draw function: given a known cell set (a small L-shape, a single cell, a rectangle), assert the produced edge segments are correct. Test via a mock Graphics that records `moveTo`/`lineTo` calls.

**Client integration / manual smoke**:

- Two-browser test: admin assigns Alice to a zone with 4 cells. Alice connects, presses `e`. Paint mode engages. Cursor white in zone, red outside. Yellow perimeter visible.
- Alice opens Tile Picker, right-clicks two tiles. Strip updates.
- Alice paints inside zone — tile appears for both players.
- Alice tries to paint outside zone — silently fails.
- Admin removes Alice from the zone. Alice's paint mode auto-exits. HUD button disappears.
- Alice tries `e` — no-op.
- Admin re-adds Alice. HUD reappears, `e` works again.

## Migration & Rollout

- No DB schema changes.
- Server changes are two endpoint auth widenings — backwards-compatible for admins (still works).
- Client changes are additive (new components, new perimeter overlay, gates on existing code paths). Admins are unaffected.

**Rollout order**:

1. Server endpoint auth widening + a unit test. Deploys; admins unaffected.
2. Client editor changes (gate + cursor tint + auto-exit). Cursor tint will not be reachable yet for non-admins because they can't enter paint mode without the next step.
3. Tile Picker window + HUD + perimeter overlay. Full UX live.

Each step is independently deployable.

## Observability

No new log lines required. The existing `paint_denied user=… x=… y=…` log from zones-core already captures attempted-but-rejected paints, which now should be rare since the client tints the cursor and disables the click. If we see frequent `paint_denied` events for a user, it likely means a client bug (the tint should have warned them).

## Future Work (out of scope)

- Per-user spawn point within zone — saved spot user warps to on connect.
- Status bar spec — fuller HUD including the existing Palette button.
- Tile preview / hover info in the Tile Picker.
- Search / filter in the Tile Picker for large catalogs.
- Touch / mobile input affordances.
