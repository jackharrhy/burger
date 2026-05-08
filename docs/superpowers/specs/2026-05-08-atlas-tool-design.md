# Atlas Tool — Phase 2 Design

Status: approved
Date: 2026-05-08
Branch: `client-react-router-eden` (continues phase 1)
Builds on: [`2026-05-08-client-react-router-eden-design.md`](./2026-05-08-client-react-router-eden-design.md)

## Goal

Replace the `/atlas` placeholder with a working tool that lets admins view atlas.png as a 32×32 grid, edit per-cell catalog metadata, save back to atlas.toml, and renumber catalog ids safely.

The atlas.png itself stays read-only — this is a metadata editor, not a graphics editor. Pixels are still painted in the maintainer's image editor of choice.

## Non-goals

- Painting pixels into atlas.png (a real graphics editor — out of scope, possibly future phase 3).
- Changing TILE_SIZE or atlas dimensions.
- Multi-file atlas catalogs.
- Per-cell animations or multi-cell tiles.
- Undo/redo. Last-write wins.

## Architecture

### Server endpoints

Two new admin-gated POST endpoints:

**`POST /api/catalog/save`** — accept the entire catalog as a JSON array of `{ id, type, src_x, src_y, label }` entries. Server validates, writes `atlas.toml`, syncs `tile_catalog` rows, and updates `world.catalog` / `world.catalogIds` in memory. Rejects deletions of ids with active tile references.

**`POST /api/catalog/rename`** — body `{ from: number, to: number }`. Atomic id renumbering: validates that `to` isn't already in use, updates `tile_catalog.id`, cascades to `tiles.tile_id`, `tile_edits.old_tile_id`, `tile_edits.new_tile_id`. Single SQLite transaction.

Both endpoints reuse the existing session cookie + `is_admin` check pattern. Non-admin requests get 403.

### Validation rules

The validator (`packages/burger-server/src/catalog-validation.ts`) is a pure function that mirrors the runtime invariants:

- Each entry has integer `id` (≥ 1), string `type` ∈ {floor, wall, counter}, integer `src_x`/`src_y` (≥ 0, ≤ atlas dimensions, multiple of TILE_SIZE), non-empty string `label`.
- IDs are unique.
- (src_x, src_y) coords are unique (one tile per source cell).
- The full set passed in **replaces** the existing catalog. Any id in the DB but not in the payload is a delete; if any of those ids are referenced by a row in `tiles`, the save is rejected with a structured error listing the offending ids.

The validator returns `{ ok: true; entries }` or `{ ok: false; errors }` so the client can display the structured errors per field.

### TOML serialization

Server writes `atlas.toml` in a stable, sorted-by-id order. The format matches the existing hand-written file (one `[[tiles]]` block per entry, fields ordered `id`, `type`, `src_x`, `src_y`, `label`). The header comment is preserved verbatim. Hand-write the serializer in `catalog-save.ts` — TOML is dead simple for this shape and pulling in a TOML serializer dep is overkill.

### Live-update broadcast

After either endpoint succeeds, broadcast `MESSAGE_TYPES.CATALOG_UPDATED = 10` to all WS clients. Payload is the new catalog as a JSON array (same shape as `GET /api/catalog`). The client's WS handler:

- Updates the local `assets.tiles` texture map (re-keys existing textures, adds new ones, drops deleted ones).
- Updates the `editor.catalog` and the editor's `catalogIds` set.
- Updates `world.catalog` / `world.catalogIds` (the imperative game's bitecs world).

Tile entities already on the client whose `Tile.type[eid]` references a renamed id won't auto-update; the server's broadcast handles that via the existing OBSERVER+SOA path (the rename mutates `tiles.tile_id` rows, but those aren't ECS entities — the ECS entities have their `Tile.type` fields, which we'd need to also update via SoA broadcast).

To keep this clean, the rename endpoint also: walks `world.tilesAtPosition`, finds entities whose `Tile.type[eid] === from`, sets `Tile.type[eid] = to`, and `markEntityDirty(eid)` for each. The SoA broadcast on the next tick carries the field updates.

### Client UI

`/atlas` route now points to a real `<Atlas/>` component. Layout:

```
┌──────────────────────────────────────────────────────┐
│ atlas tool · admin@user             [save] [reload]  │
├──────────────────────────────┬───────────────────────┤
│                              │ id: 5      [renumber] │
│   ┌─────────────────────┐    │ type: [floor v]       │
│   │   atlas grid        │    │ src: (32, 64)         │
│   │   (cells, click     │    │ label: [          ]   │
│   │    to select)       │    │                       │
│   │                     │    │ [delete this entry]   │
│   └─────────────────────┘    │                       │
│                              │ unsaved changes: 2    │
└──────────────────────────────┴───────────────────────┘
```

- Left pane: `<AtlasGrid/>` renders atlas.png scaled (e.g. 2× = 384×576 displayed) with a 32px (×scale) overlay. Cells with catalog entries get a colored border (one color per type: floor/wall/counter); empty cells stay neutral. Selected cell has a thick highlight.
- Right pane: `<CatalogForm/>` for the selected cell. If the cell has an existing entry, the form is pre-filled and a "delete this entry" button is shown. If the cell is empty, the form is blank and submitting creates a new entry (id auto-assigned on save).
- Top bar: "Save All" button (commits pending edits via `POST /api/catalog/save`); "Reload" button (refetches `/api/catalog`, discarding local edits with a confirm prompt).
- Renumber: "renumber" button next to the id field opens a small inline input for the new id. Submit calls `POST /api/catalog/rename`. This is a separate immediate action (doesn't go through the "save all" flow).

### Form state

Local component state — no Zustand. The atlas tool is a self-contained form with a clear scope:

- `entries: CatalogEntry[]` — the in-progress edits (start = server response).
- `selectedSrc: { src_x, src_y } | null` — which cell is selected.
- `dirty: boolean` — whether `entries` differs from the last server snapshot.

On Save All success, the loader re-runs (RR's `revalidate()`) and `entries` resets.

### Eden integration

The new endpoints become typed automatically through the `App` re-export from phase 1. The atlas component uses:

```ts
const { data, error } = await eden.api.catalog.save.post({ entries });
const { data, error } = await eden.api.catalog.rename.post({ from, to });
```

Errors come back as structured JSON: `{ ok: false, errors: [{ field, message }] }` for validation; HTTP 403 for non-admin; HTTP 409 for "id in use" (rename) or "id has tiles" (delete).

### File changes

| Path                                                     | Action                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/burger-shared/src/const.shared.ts`             | Add `MESSAGE_TYPES.CATALOG_UPDATED = 10`.                                        |
| `packages/burger-server/src/catalog-validation.ts`       | NEW. Pure validator.                                                             |
| `packages/burger-server/src/catalog-save.ts`             | NEW. atlas.toml serialize + DB sync + broadcast.                                 |
| `packages/burger-server/src/catalog-rename.ts`           | NEW. Atomic rename transaction + ECS dirty marking.                              |
| `packages/burger-server/src/app.ts`                      | Add 2 POST routes.                                                               |
| `packages/burger-server/src/network.server.ts`           | Add `broadcastCatalogUpdated(catalog)` helper.                                   |
| `packages/burger-server/test/catalog-validation.test.ts` | NEW.                                                                             |
| `packages/burger-server/test/catalog-save.test.ts`       | NEW.                                                                             |
| `packages/burger-server/test/catalog-rename.test.ts`     | NEW.                                                                             |
| `packages/burger-server/test/catalog-e2e.test.ts`        | NEW. End-to-end with admin/non-admin/conflict cases.                             |
| `packages/burger-client/src/routes/Atlas.tsx`            | Replace placeholder with the real tool.                                          |
| `packages/burger-client/src/atlas/AtlasGrid.tsx`         | NEW. The grid display component.                                                 |
| `packages/burger-client/src/atlas/CatalogForm.tsx`       | NEW. The right-pane form.                                                        |
| `packages/burger-client/src/atlas/types.ts`              | NEW. Local types (`CatalogEntry`, etc.).                                         |
| `packages/burger-client/src/game/network.ts`             | Handle `CATALOG_UPDATED` message: refetch + update assets.tiles + world.catalog. |
| `packages/burger-client/src/router.ts`                   | Update `atlasLoader` to also fetch `/api/catalog`.                               |
| `packages/burger-client/src/style.css`                   | Atlas tool styles.                                                               |

### Tests

- `catalog-validation.test.ts`: pure unit tests covering all validation rules (missing id, duplicate id, invalid type, off-grid src_x, empty label, etc.).
- `catalog-save.test.ts`: in-memory DB tests for the save handler. Verify atlas.toml content matches expected output, tile_catalog rows synced, broadcast called.
- `catalog-rename.test.ts`: in-memory DB tests for atomic rename. Verify all tables updated, transaction rolls back on conflict, ECS Tile.type[eid] mutations are made.
- `catalog-e2e.test.ts`: real Elysia server with admin/non-admin sessions. Tests:
  - Non-admin POST /api/catalog/save → 403.
  - Admin POST /api/catalog/save with valid entries → 200, atlas.toml written, GET /api/catalog returns updated.
  - Admin POST /api/catalog/save with deletion of an id used by tiles → 409.
  - Admin POST /api/catalog/rename → 200, atomic update applied.
  - Admin POST /api/catalog/rename to an in-use id → 409.

## Risks

1. **atlas.toml round-tripping.** The original file has a header comment. Our serializer must preserve it (or accept losing it on the first save). Decision: preserve the header comment by hardcoding it in the serializer. If the user adds custom comments later, those WILL be lost on the next save — flag in the UI ("save will overwrite the file with auto-generated TOML; existing comments are preserved but new ones are not").

2. **Renumber + tiles in flight.** If a paint message is being processed at the same moment as a rename, there's a tiny window where a tile could land with the old id. Mitigation: the rename runs in a SQLite transaction that locks tile_catalog and tiles; concurrent paints will block briefly. Bun's sqlite is synchronous so this is straightforward — both code paths run on the main loop and don't actually overlap.

3. **Live-update broadcast on a busy server.** Catalog updates are rare (admin-driven, not user-driven), so spamming the OBSERVER channel isn't a risk. Single-shot broadcast per save.

4. **Editor in-game catalog drift.** When `CATALOG_UPDATED` arrives, the in-game editor's palette may need to refresh. The handler updates `editor.catalog` and `editor.catalogIds`, plus rebuilds the palette UI. This is some imperative DOM work that needs care; covered in the plan.

5. **TOML serialization edge cases.** Strings with quotes, multi-line values, etc. The catalog only has alphanumeric labels in practice, but the serializer should escape double quotes inside strings (`"` → `\"`) defensively. Test fixture for `label: 'tile "wall"'` to confirm.
