# PR C — In-game editor

Status: approved
Part of: [`2026-05-08-editor-and-auth-overview.md`](./2026-05-08-editor-and-auth-overview.md)
Depends on: PR A (auth, isAdmin on PlayerConnection), PR B (tile catalog, tiles table, bounds).

## Goal

Add an in-game tile painter for admins. Toggle edit mode with `e`, see a tile cursor at the snapped position under the mouse, click to paint, right-click to erase. Palette hotbar at the bottom of the screen lists every tile in the catalog. Paints persist in SQLite via the tile store from PR B and propagate to all connected clients.

## Non-goals (this PR)

- Spawn zone editor (deferred — set via direct DB edit for now).
- Catalog editing in-game.
- Multi-tile paint (rectangle, fill, line tools).
- Client-side paint prediction (server is authoritative; ~17ms latency is fine for placement).
- Per-edit attribution UI / "who painted this tile" hover.
- Undo/redo UI (the tile_edits log makes this implementable later).

## Architecture

### New files

- `packages/burger-server/src/paint.ts` — paint message handler. Validates, authorizes, rate-limits, applies to DB, applies to ECS.
- `packages/burger-server/src/paint-validation.ts` — pure `validatePaint(raw, world, catalog) → ValidatedPaint | null`.
- `packages/burger-client/src/editor.client.ts` — edit-mode systems: cursor, palette, click handlers.
- `packages/burger-server/test/paint-validation.test.ts` — pure-function tests.
- `packages/burger-server/test/paint-e2e.test.ts` — e2e tests for paint authorization.

### Modified files

- `packages/burger-shared/src/const.shared.ts` — adds `MESSAGE_TYPES.PAINT = 8` and `MAX_PAINTS_PER_TICK = 4`.
- `packages/burger-server/src/network.server.ts` — message handler dispatches `paint` type to `paint.ts`. Adds `paintsThisTick: number` to PlayerConnection. Resets the counter at the top of every tick.
- `packages/burger-server/src/server.ts` — calls `connection.paintsThisTick = 0` in the active tick loop, before processing.
- `packages/burger-client/src/client.ts` — boots editor systems if `me.isAdmin`, wires up the editor's update step in the system loop.
- `packages/burger-client/src/network.client.ts` — `sendPaint(network, x, y, tileId)` helper.
- `packages/burger-server/src/server.ts` — adds `GET /api/catalog` endpoint returning the catalog rows as JSON.

### Wire protocol

Add to const.shared.ts:

```ts
export const MESSAGE_TYPES = {
  // ...existing
  PAINT: 8,
} as const;

export const MAX_PAINTS_PER_TICK = 4;
```

Client → server JSON over WebSocket:
```ts
{ type: "paint", x: number, y: number, tileId: number | null }
```

- `tileId = null` is an erase.
- `x`, `y` are pixel coords aligned to `TILE_SIZE`.

No new server → client message. Paints propagate via the existing bitECS observer serializer (Tile entities are already Networked; adding/removing them or changing their `Tile.type` triggers an observer delta in the next `broadcastGameState`).

### Server flow

`paint.ts`:

```ts
export const handlePaintMessage = (
  world: World,
  db: Database,
  connection: PlayerConnection,
  data: unknown,
): void => {
  const cmd = validatePaint(data, world, world.catalog);
  if (!cmd) return;
  if (!connection.isAdmin) return;
  if (connection.paintsThisTick >= MAX_PAINTS_PER_TICK) return;
  connection.paintsThisTick++;

  applyPaint(world, db, cmd, connection.userId);
};
```

`applyPaint`:

```ts
const applyPaint = (
  world: World,
  db: Database,
  cmd: ValidatedPaint,
  userId: string,
): void => {
  const { x, y, tileId } = cmd;
  const key = `${x},${y}`;
  const existingEid = world.tilesAtPosition.get(key);
  const oldTileId = existingEid !== undefined ? world.components.Tile.type[existingEid]! : null;

  db.transaction(() => {
    if (tileId === null) {
      db.run("DELETE FROM tiles WHERE x = ? AND y = ?", [x, y]);
    } else {
      db.run(
        "INSERT INTO tiles (x, y, tile_id) VALUES (?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET tile_id = excluded.tile_id",
        [x, y, tileId],
      );
    }
    db.run(
      "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (?, ?, ?, ?, ?, ?)",
      [x, y, oldTileId, tileId, userId, Date.now()],
    );
  })();

  applyToEcs(world, x, y, tileId, existingEid);
};
```

`applyToEcs` either:
- Erase: `removeEntity(world, existingEid)` and `world.tilesAtPosition.delete(key)`.
- Add: create a new entity, addComponent Position/Tile/Networked/(Solid?), set `world.tilesAtPosition.set(key, eid)`.
- Update: change `Tile.type[eid]` and add/remove Solid based on the new type's solidness.

Bitecs's observer serializer handles the broadcasting. No manual notification needed.

### Paint validation

`paint-validation.ts`:

```ts
export type ValidatedPaint = { x: number; y: number; tileId: number | null };

export const validatePaint = (
  raw: unknown,
  world: { bounds: { x: number; y: number; w: number; h: number } },
  catalog: Set<number>,
): ValidatedPaint | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "paint") return null;
  if (!Number.isInteger(r.x) || !Number.isInteger(r.y)) return null;
  const x = r.x as number;
  const y = r.y as number;
  if (x % TILE_SIZE !== 0 || y % TILE_SIZE !== 0) return null;
  if (x < world.bounds.x || x >= world.bounds.x + world.bounds.w) return null;
  if (y < world.bounds.y || y >= world.bounds.y + world.bounds.h) return null;
  if (r.tileId !== null) {
    if (!Number.isInteger(r.tileId)) return null;
    if (!catalog.has(r.tileId as number)) return null;
  }
  return { x, y, tileId: r.tileId as number | null };
};
```

`world.catalog` is a `Set<number>` of valid catalog IDs, populated at boot from `tile_catalog`. Updated never (catalog doesn't change at runtime).

### Tick integration

Per-tick paint counter reset is the only addition to the active tick:

```ts
const activeTick = () => {
  for (const [, connection] of getPlayerConnections()) {
    connection.paintsThisTick = 0;
  }
  // ...existing tick body
};
```

This is the simplest way to enforce the cap. The handler increments; the tick resets.

### Catalog endpoint

`GET /api/catalog` returns the catalog as JSON:

```ts
.get("/api/catalog", () => {
  return db.query("SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id").all();
})
```

The existing `/api/atlas` endpoint can stay for the moment (used by non-admin clients to render existing tiles). Or we can drop it — the catalog response carries all the info needed for the existing `loadAssets` to build its `tiles` texture map. Pick: drop `/api/atlas` and have all clients use `/api/catalog`. Less code.

`packages/burger-client/src/client.ts`'s `loadAssets`:

```ts
const catalog = await (await fetch("/api/catalog")).json() as CatalogEntry[];
const tiles: Record<number, Texture> = {};
for (const entry of catalog) {
  tiles[entry.id] = new Texture({
    source: atlas,
    frame: new Rectangle(entry.src_x, entry.src_y, TILE_SIZE, TILE_SIZE),
  });
}
return { atlas, player, tiles, catalog };
```

Note: tile lookup is keyed by catalog ID. PR B's "Tile.type semantics change" section established that `Tile.type[eid]` holds the catalog ID; PR C uses this to look up textures in the catalog-id-keyed `tiles` map.

### Client editor

`editor.client.ts`:

```ts
export type CatalogEntry = {
  id: number;
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};

export type EditorState = {
  active: boolean;
  selectedTileId: number;
  catalog: CatalogEntry[];
  cursorX: number;     // snapped pixel coord
  cursorY: number;
  cursorVisible: boolean;
  cursorSprite: Sprite | null;
  paletteContainer: Container | null;
  paletteSlots: Sprite[];
  isPainting: boolean;     // mouse held
  paintErase: boolean;     // current drag is erase (right-button)
  lastPaintedKey: string | null;  // de-dup paints during a single drag
};
```

`initEditor(context)`:
- Creates a Pixi Container for the palette (overlay, not inside `mainContainer` — palette is screen-fixed).
- Builds palette slots: one Sprite per catalog entry, laid out in a row at the bottom.
- Creates a cursor preview Sprite (initially hidden).
- Wires window listeners: keydown for toggle (`e`), keydown for slot select (`1`-`9`), wheel for slot cycle, mousemove to update cursor, mousedown/mouseup for paint.

`editorSystem(context)`:
- If `editor.active`: update cursor sprite position to snapped mouse world coord. Show/hide based on viewport.
- Update palette slot highlight to match `selectedTileId`.
- If `isPainting`: read current cursor coord, if different from `lastPaintedKey`, send a paint message and update `lastPaintedKey`.

The screen→world conversion uses the existing camera math:
```ts
const worldX = (mouseX - app.screen.width / 2 + camera.x * ZOOM) / ZOOM;
const worldY = (mouseY - app.screen.height / 2 + camera.y * ZOOM) / ZOOM;
const snappedX = Math.floor(worldX / TILE_SIZE) * TILE_SIZE;
const snappedY = Math.floor(worldY / TILE_SIZE) * TILE_SIZE;
```

#### Palette layout

- Palette container at `app.stage.addChild(paletteContainer)` (after main container so it draws on top).
- Each slot is `40px × 40px` (32px tile + 4px padding on each side).
- Lay out horizontally starting from the left edge.
- On window resize, reposition `paletteContainer.y = app.screen.height - 40`.
- Selected slot gets a 2px white border (a Graphics object child).
- Click handler on each slot: `editor.selectedTileId = entry.id`.

#### Keyboard / mouse bindings

- `e` (or `Tab`): toggle `editor.active`.
- `1`-`9`: select first 9 catalog entries (if present).
- Mouse wheel up/down: cycle `selectedTileId` to next/previous catalog entry.
- Left mouse on canvas: start painting with selected tile.
- Right mouse on canvas: start erasing.
- Mouse move with button held: continue painting/erasing.
- Mouse up: stop painting.

The mouse listeners attach to the canvas only, not document-wide, so they don't interfere with the lil-gui debug panel.

### Non-admin flow

Non-admin clients never receive the catalog or render the editor. The check is at boot time:

```ts
if (me.isAdmin) {
  context.editor = initEditor(context);
}
```

A non-admin who somehow knows the protocol and sends a paint message gets it dropped server-side (the isAdmin check). No leakage.

## Tests

`packages/burger-server/test/paint-validation.test.ts`:

- Valid paint passes.
- Erase (tileId: null) passes.
- Rejects non-object, wrong type, non-integer x/y.
- Rejects x/y not aligned to TILE_SIZE.
- Rejects x/y outside bounds (each edge).
- Rejects tileId not in catalog.
- Rejects tileId not integer.
- Drops unknown fields.

`packages/burger-server/test/paint-e2e.test.ts`:

- **Non-admin paint rejected**: connect with non-admin session, send paint, assert no DB row created and no broadcast.
- **Admin paint creates tile**: connect with admin session, send paint, assert tile row in DB, tile_edit row, ECS entity created, broadcast received.
- **Admin paint replaces existing tile**: pre-seed a tile, paint over it, assert replacement, two tile_edit rows total (the seed + the overwrite).
- **Admin paint with null tileId erases**: pre-seed a tile, paint with tileId=null, assert tile gone from DB, tile_edit row with new_tile_id=NULL.
- **Out-of-bounds paint rejected**: admin sends paint at (-1, -1), assert nothing happens.
- **Bad tileId rejected**: admin sends paint with tileId=999, assert nothing happens.
- **Rate limit**: admin sends 100 paints in one tick, assert only MAX_PAINTS_PER_TICK landed in DB. Subsequent ticks accept more paints.

These reuse the e2e harness from PR A (with auth-aware connections).

## Risks for this PR

- **bitecs observer behavior on tile updates.** Today the only Networked entities being added/removed at runtime are players. PR C adds tile add/remove/update at runtime. The observer serializer should handle this, but worth verifying on the smoke test that tiles correctly appear/disappear on a second connected client.
- **Cursor positioning at world edges.** When the mouse hovers near the screen edge, the snapped cursor coord might be just outside `world.bounds`. The cursor preview should still display (showing where you'd paint if you could) but the paint should be rejected server-side. That's fine; just call out so the UX isn't surprising.
- **Catalog drift between server and client.** If the server boots, then the maintainer edits atlas.toml and restarts, connected clients have a stale catalog. They'll see paints with unknown tile IDs (the bitECS Tile.type carries the new ID, but the client's `tiles` map doesn't have a texture for it). Mitigation: client logs a warning and shows a fallback color. Reload fixes it.
- **Paint floods near the rate limit.** A click-and-drag at high mouse speed paints up to ~60 tiles/sec on a 60Hz monitor. With MAX_PAINTS_PER_TICK=4 (~240/sec), there's plenty of headroom. Confirmed reasonable.
- **Right-click context menu interception.** The browser's right-click context menu fires on the canvas. We need `event.preventDefault()` in the contextmenu handler to suppress it. Easy to forget.

## Branch & commit plan (within PR C)

1. `feat: add MESSAGE_TYPES.PAINT and MAX_PAINTS_PER_TICK constants`
2. `feat: paint validation with bounds and catalog check`
3. `feat: server paint handler with admin gate, rate limit, db transaction`
4. `feat: GET /api/catalog endpoint`
5. `feat: client editor cursor preview and palette`
6. `feat: paint click and drag handlers`
7. `test: paint validation and e2e tests`
8. `chore: drop /api/atlas in favor of /api/catalog (and client switch)`

PR title: `In-game tile editor (PR C of 3)`
