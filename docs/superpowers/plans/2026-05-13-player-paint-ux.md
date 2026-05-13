# Player Paint UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer the non-admin paint UX on top of zones-core: paint-mode gate, red cursor tint, zone perimeter outline, Tile Picker window, and a single-button HUD that opens it. Server change is minimal (widen `/api/palette` auth).

**Architecture:** Server widens 2 endpoint auth checks from admin-only to authenticated-user. Client extends `editor.ts` with a gate + cursor-tint check, adds a perimeter-overlay module mirroring the zones overlay's shape, adds 2 React components (TilePickerWindow + NonAdminHud), and removes the admin-only gate around `initEditor`.

**Tech Stack:** Bun + Elysia + bun:sqlite (server), bitecs ECS, React + Pixi.js v8 + Zustand + Eden Treaty (client). bun:test, oxlint --deny-warnings, oxfmt.

**Spec:** `docs/superpowers/specs/2026-05-13-player-paint-ux-design.md`

---

## File Structure

### Server (modified)

- `packages/burger-server/src/app.ts` — change `requireAdmin` → `requireUser` for two palette endpoints. Add a small `requireUser` helper near `requireAdmin`.

### Client (new)

- `packages/burger-client/src/game/zones-perimeter.ts` — pixi Graphics state + `drawPerimeter` function for the user's own zone outline. Mirrors `zones.ts` shape.
- `packages/burger-client/src/windows/TilePickerWindow.tsx` — flat catalog grid, right-click toggles palette membership.
- `packages/burger-client/src/windows/NonAdminHud.tsx` — single-button HUD ("Palette") for non-admins with a zone.

### Client (modified)

- `packages/burger-client/src/game/editor.ts` — add `canEnterPaintMode` gate; in `updateEditor`, add `canPaintCell` check that tints cursor red over forbidden cells; add Escape handler.
- `packages/burger-client/src/game/index.ts` — remove `if (isAdmin)` gate around `initEditor` so non-admins also get the editor; init zones-perimeter overlay for non-admins; subscribe to `myZoneCells` for redraw + auto-exit.
- `packages/burger-client/src/windows/WindowManager.tsx` — register `WINDOW_TILE_PICKER`, render `<NonAdminHud />` at root for non-admins.

### Tests

- `packages/burger-server/test/palette-e2e.test.ts` — extend existing file: non-admin can GET/PUT palette.
- `packages/burger-client/test/editor.test.ts` (new) — unit tests for `canEnterPaintMode` and `canPaintCell` (pure functions).
- `packages/burger-client/test/zones-perimeter.test.ts` (new) — unit test `drawPerimeter` produces correct edge segments for known cell shapes.

---

## Conventions

- All work on branch `feat/player-paint-ux` (forked from `feat/zones-core`; will rebase / merge cleanly when zones-core lands).
- After every code change: `pnpm lint && pnpm fmt:check && pnpm --filter burger-server exec tsc --noEmit && pnpm --filter burger-client exec tsc --noEmit && pnpm --filter burger-server test --bail`.
- TILE_SIZE = 32; cell-center coords; `"x,y"` key shape (matches zones-core, `tilesAtPosition`, etc.).
- Conventional commit messages.

---

## Task 1: Server — widen palette endpoints to authenticated-user

**Files:**

- Modify: `packages/burger-server/src/app.ts`
- Test: `packages/burger-server/test/palette-e2e.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/burger-server/test/palette-e2e.test.ts`:

```ts
test("non-admin GET /api/palette returns 200 with own (empty) palette", async () => {
  const sess = setupSession(db, false);
  const { status, data } = await req("GET", "/api/palette", undefined, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true, ids: [] });
});

test("non-admin PUT /api/palette persists own palette", async () => {
  const sess = setupSession(db, false);
  const put = await req("PUT", "/api/palette", { ids: [1, 2] }, sess);
  expect(put.status).toBe(200);
  expect(put.data).toEqual({ ok: true, ids: [1, 2] });

  const get = await req("GET", "/api/palette", undefined, sess);
  expect(get.data).toEqual({ ok: true, ids: [1, 2] });
});

test("unauthenticated GET /api/palette returns 403", async () => {
  const { status } = await req("GET", "/api/palette", undefined);
  expect(status).toBe(403);
});

test("non-admin cannot modify another user's palette", async () => {
  const sessAlice = setupSession(db, false, "alice");
  const sessBob = setupSession(db, false, "bob");
  // Alice sets her palette.
  await req("PUT", "/api/palette", { ids: [1] }, sessAlice);
  // Bob's GET reflects Bob's empty palette, not Alice's.
  const bobGet = await req("GET", "/api/palette", undefined, sessBob);
  expect(bobGet.data).toEqual({ ok: true, ids: [] });
});
```

Also UPDATE the existing test `"non-admin GET /api/palette returns 403"` — that test will start failing once we widen the endpoint. Replace it with the version above (which expects 200, empty).

Find the line `test("non-admin GET /api/palette returns 403", async () => {` in `palette-e2e.test.ts` and remove the whole test block (the new tests above supersede it).

- [ ] **Step 2: Run tests to verify the new ones fail (and the old one)**

```bash
pnpm --filter burger-server test palette-e2e.test.ts 2>&1 | tail -20
```

Expected: the new "non-admin GET" and "non-admin PUT" tests FAIL (still admin-only); the new "unauthenticated" test passes (current admin check returns 403 for both unauth and non-admin).

- [ ] **Step 3: Add a `requireUser` helper**

In `packages/burger-server/src/app.ts`, find the `requireAdmin` function (around line 101). Add a sibling `requireUser` function right after it:

```ts
const requireUser = (
  cookieHeader: string | null,
): { ok: true; userId: string } | { ok: false } => {
  const sessionId = parseSessionCookie(cookieHeader);
  if (!sessionId) return { ok: false };
  const session = getSession(db, sessionId);
  if (!session) return { ok: false };
  const user = getUserById(db, session.userId);
  if (!user) return { ok: false };
  return { ok: true, userId: user.id };
};
```

This is the same as `requireAdmin` minus the `!user.isAdmin` check.

- [ ] **Step 4: Use `requireUser` in the palette endpoints**

In `packages/burger-server/src/app.ts`, find the two palette endpoint handlers (around lines 375 and 387). In each, replace:

```ts
const auth = requireAdmin(headers.cookie ?? null);
if (!auth.ok) {
  set.status = 403;
  return {
    ok: false,
    errors: [{ field: "auth", message: "admin required" }],
  };
}
```

with:

```ts
const auth = requireUser(headers.cookie ?? null);
if (!auth.ok) {
  set.status = 403;
  return {
    ok: false,
    errors: [{ field: "auth", message: "authentication required" }],
  };
}
```

Do this for BOTH the `.get("/api/palette", ...)` and `.put("/api/palette", ...)` handlers.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter burger-server test palette-e2e.test.ts 2>&1 | tail -20
```

Expected: all palette-e2e tests pass.

- [ ] **Step 6: Full suite + lint + typecheck + fmt**

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/burger-server/src/app.ts packages/burger-server/test/palette-e2e.test.ts
git commit -m "feat(server): widen /api/palette to authenticated users"
```

---

## Task 2: Client — `canEnterPaintMode` and `canPaintCell` pure functions

**Files:**

- Modify: `packages/burger-client/src/game/editor.ts` (add 2 exported pure functions)
- Create: `packages/burger-client/test/editor.test.ts`

If `packages/burger-client/test/` doesn't exist, create it. First check if vitest/bun-test is configured for the client package — look at `packages/burger-client/package.json` for a "test" script.

- [ ] **Step 1: Check if client has a test runner**

Run:

```bash
cat packages/burger-client/package.json
```

Look for a `test` script. If one exists, use that runner. If NOT, the client package doesn't currently run tests — we'll skip per-package unit tests and add pure-function tests to the existing `packages/burger-shared/` test suite (which uses bun:test). For this plan we assume bun:test will work from the shared package even when importing from the client, OR we add a minimal bun-test script to the client.

If the client has no test script, ADD ONE in `packages/burger-client/package.json`:

```json
"test": "bun test"
```

Then create `packages/burger-client/bunfig.toml` if it doesn't exist:

```toml
[test]
preload = []
```

- [ ] **Step 2: Write the failing tests**

Create `packages/burger-client/test/editor.test.ts`:

```ts
import { expect, test, describe } from "bun:test";
import { canEnterPaintMode, canPaintCell } from "../src/game/editor";

type FakeUser = { isAdmin: boolean };

describe("canEnterPaintMode", () => {
  test("admin always allowed (empty cells)", () => {
    const user: FakeUser = { isAdmin: true };
    expect(canEnterPaintMode(user, new Set())).toBe(true);
  });

  test("admin always allowed (non-empty cells)", () => {
    const user: FakeUser = { isAdmin: true };
    expect(canEnterPaintMode(user, new Set(["16,16"]))).toBe(true);
  });

  test("non-admin with empty zone cells rejected", () => {
    const user: FakeUser = { isAdmin: false };
    expect(canEnterPaintMode(user, new Set())).toBe(false);
  });

  test("non-admin with non-empty zone cells allowed", () => {
    const user: FakeUser = { isAdmin: false };
    expect(canEnterPaintMode(user, new Set(["16,16"]))).toBe(true);
  });
});

describe("canPaintCell", () => {
  test("admin always allowed", () => {
    const user: FakeUser = { isAdmin: true };
    expect(canPaintCell(user, new Set(), "16,16")).toBe(true);
  });

  test("non-admin allowed iff key in set", () => {
    const user: FakeUser = { isAdmin: false };
    const cells = new Set(["16,16", "48,16"]);
    expect(canPaintCell(user, cells, "16,16")).toBe(true);
    expect(canPaintCell(user, cells, "80,16")).toBe(false);
  });

  test("non-admin with empty set never allowed", () => {
    const user: FakeUser = { isAdmin: false };
    expect(canPaintCell(user, new Set(), "16,16")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter burger-client test 2>&1 | tail -15
```

Expected: import errors on `canEnterPaintMode` and `canPaintCell`.

- [ ] **Step 4: Add the pure functions to editor.ts**

At the top of `packages/burger-client/src/game/editor.ts` (just below the existing imports), add:

```ts
export const canEnterPaintMode = (
  user: { isAdmin: boolean },
  myZoneCells: Set<string>,
): boolean => {
  if (user.isAdmin) return true;
  return myZoneCells.size > 0;
};

export const canPaintCell = (
  user: { isAdmin: boolean },
  myZoneCells: Set<string>,
  key: string,
): boolean => {
  if (user.isAdmin) return true;
  return myZoneCells.has(key);
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter burger-client test 2>&1 | tail -10
```

Expected: 7 tests PASS.

- [ ] **Step 6: Lint + typecheck + fmt**

```bash
pnpm lint 2>&1 | tail -3 && pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/burger-client/src/game/editor.ts packages/burger-client/test/editor.test.ts packages/burger-client/package.json packages/burger-client/bunfig.toml
git commit -m "feat(client): canEnterPaintMode + canPaintCell pure functions"
```

---

## Task 3: Editor gates entry on `canEnterPaintMode` + adds Escape exit

**Files:**

- Modify: `packages/burger-client/src/game/editor.ts`

`initEditor` doesn't currently know about `myZoneCells` or the user. It needs both to gate entry. We add an option `getCanEnterPaintMode: () => boolean` and another option `getCanPaintCell: (key: string) => boolean` to `InitEditorOptions`. The caller (`game/index.ts`) wires these to the store.

- [ ] **Step 1: Extend `InitEditorOptions`**

In `packages/burger-client/src/game/editor.ts`, find the `InitEditorOptions` type definition (around line 146). Replace it with:

```ts
export type InitEditorOptions = {
  onTogglePaintMode?: (mode: PaintMode) => void;
  // Called when the user tries to enter paint mode. If returns false, entry
  // is blocked silently. Defaults to "always allow" if omitted.
  getCanEnterPaintMode?: () => boolean;
  // Called per cursor cell to decide cursor tint. If returns false, cursor
  // shows red tint + red outline. Defaults to "always allow" if omitted.
  getCanPaintCell?: (key: string) => boolean;
};
```

- [ ] **Step 2: Gate the `e` / `Tab` toggle on `getCanEnterPaintMode`**

In `packages/burger-client/src/game/editor.ts`, find the `e` / `Tab` keydown handler (around line 225). Modify the entry path:

```ts
if (e.key === "e" || e.key === "Tab") {
  e.preventDefault();
  const goingActive = !state.active;
  if (goingActive && opts.getCanEnterPaintMode?.() === false) {
    // Silent no-op: user has no zones, etc.
    return;
  }
  state.active = goingActive;
  palette.visible = state.active;
  if (!state.active && state.cursorSprite && state.cursorOutline) {
    state.cursorSprite.visible = false;
    state.cursorOutline.visible = false;
  }
  useGameStore.getState().setEditorActive(state.active);
  opts.onTogglePaintMode?.(state.active ? "tile" : "none");
  return;
}
```

- [ ] **Step 3: Add Escape exit**

In the same keydown handler block, BEFORE the `e` / `Tab` branch, add:

```ts
if (e.key === "Escape" && state.active) {
  e.preventDefault();
  state.active = false;
  palette.visible = false;
  if (state.cursorSprite && state.cursorOutline) {
    state.cursorSprite.visible = false;
    state.cursorOutline.visible = false;
  }
  useGameStore.getState().setEditorActive(false);
  opts.onTogglePaintMode?.("none");
  return;
}
```

- [ ] **Step 4: Use `getCanPaintCell` to tint the cursor in `updateEditor`**

In `packages/burger-client/src/game/editor.ts`, find `updateEditor` (search `export const updateEditor`). The current function updates `cursorSprite.x/y` and `cursorOutline`. Modify the body so that AFTER computing `state.cursorX` and `state.cursorY`, the cursor's tint and outline color reflect `getCanPaintCell`.

Find the section in `updateEditor` that sets cursor position and updates the outline graphics. After those updates, add:

```ts
// Cursor visual feedback for non-admin paint mode. If the cursor is over
// a cell the user cannot paint, tint sprite red and draw outline red.
const key = `${state.cursorX},${state.cursorY}`;
const allowed = opts.getCanPaintCell?.(key) ?? true;
state.cursorSprite.tint = allowed ? 0xffffff : 0xff4040;
state.cursorOutline.clear();
state.cursorOutline
  .rect(
    state.cursorX - halfTile,
    state.cursorY - halfTile,
    TILE_SIZE,
    TILE_SIZE,
  )
  .stroke({ color: allowed ? 0xffffff : 0xff4040, width: 1 });
```

(`opts` must be in scope inside `updateEditor`. Currently `updateEditor` doesn't receive `opts` — verify the function signature.) If `updateEditor` doesn't have access to `opts`, either:

(a) Move the tint code into the `state` object: capture `getCanPaintCell` into `state` during `initEditor`, then `updateEditor` reads `state.getCanPaintCell`. OR
(b) Pass `opts` (or just `getCanPaintCell`) into `updateEditor`.

Option (a) is cleaner since `state` already carries the editor's mutable state. Implement it that way:

In `EditorState` (search for `export type EditorState` or wherever the state shape is defined), add:

```ts
getCanPaintCell: (key: string) => boolean;
```

In `initEditor`, when constructing the state object, set:

```ts
  getCanPaintCell: opts.getCanPaintCell ?? (() => true),
```

In `updateEditor`, use `state.getCanPaintCell(key)`:

```ts
const key = `${state.cursorX},${state.cursorY}`;
const allowed = state.getCanPaintCell(key);
state.cursorSprite.tint = allowed ? 0xffffff : 0xff4040;
state.cursorOutline.clear();
state.cursorOutline
  .rect(
    state.cursorX - halfTile,
    state.cursorY - halfTile,
    TILE_SIZE,
    TILE_SIZE,
  )
  .stroke({ color: allowed ? 0xffffff : 0xff4040, width: 1 });
```

You'll need `halfTile` and `TILE_SIZE` accessible — they're likely already imported. Check existing `updateEditor` code for the existing outline-drawing logic and pattern-match.

- [ ] **Step 5: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 warnings, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-client/src/game/editor.ts
git commit -m "feat(client): paint-mode entry gate + Escape exit + cursor tint hook"
```

---

## Task 4: `zones-perimeter.ts` overlay module + unit tests

**Files:**

- Create: `packages/burger-client/src/game/zones-perimeter.ts`
- Create: `packages/burger-client/test/zones-perimeter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/burger-client/test/zones-perimeter.test.ts`:

```ts
import { expect, test, describe } from "bun:test";
import { computePerimeterSegments } from "../src/game/zones-perimeter";
import { TILE_SIZE } from "burger-shared";

const H = TILE_SIZE / 2;
const T = TILE_SIZE;

describe("computePerimeterSegments", () => {
  test("single cell has 4 edges", () => {
    const cells = new Set([`${H},${H}`]);
    const segments = computePerimeterSegments(cells);
    expect(segments.length).toBe(4);
  });

  test("two adjacent cells share an edge — 6 edges total", () => {
    // Cells at (H, H) and (H + T, H) are horizontally adjacent.
    const cells = new Set([`${H},${H}`, `${H + T},${H}`]);
    const segments = computePerimeterSegments(cells);
    // Each cell would have 4 edges; shared edge removed from both: 4 + 4 - 2 = 6.
    expect(segments.length).toBe(6);
  });

  test("2x2 block has 8 perimeter edges", () => {
    const cells = new Set([
      `${H},${H}`,
      `${H + T},${H}`,
      `${H},${H + T}`,
      `${H + T},${H + T}`,
    ]);
    const segments = computePerimeterSegments(cells);
    expect(segments.length).toBe(8);
  });

  test("empty cell set returns no segments", () => {
    expect(computePerimeterSegments(new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter burger-client test zones-perimeter.test.ts 2>&1 | tail -10
```

Expected: import error.

- [ ] **Step 3: Implement `zones-perimeter.ts`**

Create `packages/burger-client/src/game/zones-perimeter.ts`:

```ts
import { Container, Graphics } from "pixi.js";
import { TILE_SIZE } from "burger-shared";

export type PerimeterState = {
  cells: Set<string>;
  visible: boolean;
  overlay: Graphics;
};

export type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * Walks each cell's 4 cardinal neighbors. For each missing neighbor,
 * emits the edge segment between the cell and that neighbor. The result
 * is the perimeter of the cell set (no interior edges).
 *
 * Keys are "x,y" strings of tile-cell centers (TILE_SIZE/2 + n*TILE_SIZE).
 */
export const computePerimeterSegments = (cells: Set<string>): Segment[] => {
  const half = TILE_SIZE / 2;
  const segments: Segment[] = [];
  for (const key of cells) {
    const [xStr, yStr] = key.split(",");
    const x = Number(xStr);
    const y = Number(yStr);
    // North edge (above cell)
    if (!cells.has(`${x},${y - TILE_SIZE}`)) {
      segments.push({ x1: x - half, y1: y - half, x2: x + half, y2: y - half });
    }
    // South edge (below)
    if (!cells.has(`${x},${y + TILE_SIZE}`)) {
      segments.push({ x1: x - half, y1: y + half, x2: x + half, y2: y + half });
    }
    // West edge (left)
    if (!cells.has(`${x - TILE_SIZE},${y}`)) {
      segments.push({ x1: x - half, y1: y - half, x2: x - half, y2: y + half });
    }
    // East edge (right)
    if (!cells.has(`${x + TILE_SIZE},${y}`)) {
      segments.push({ x1: x + half, y1: y - half, x2: x + half, y2: y + half });
    }
  }
  return segments;
};

export const initPerimeter = (parent: Container): PerimeterState => {
  const overlay = new Graphics();
  parent.addChild(overlay);
  overlay.visible = false;
  return { cells: new Set(), visible: false, overlay };
};

export const setPerimeterCells = (
  state: PerimeterState,
  cells: Set<string>,
): void => {
  state.cells = cells;
  if (state.visible) redrawPerimeter(state);
};

export const setPerimeterVisible = (
  state: PerimeterState,
  visible: boolean,
): void => {
  state.visible = visible;
  state.overlay.visible = visible;
  if (visible) redrawPerimeter(state);
};

export const redrawPerimeter = (state: PerimeterState): void => {
  const g = state.overlay;
  g.clear();
  const segments = computePerimeterSegments(state.cells);
  if (segments.length === 0) return;
  for (const seg of segments) {
    g.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2);
  }
  g.stroke({ color: 0xffd966, width: 2, alpha: 0.7 });
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter burger-client test zones-perimeter.test.ts 2>&1 | tail -10
```

Expected: 4 tests PASS.

- [ ] **Step 5: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 warnings, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/burger-client/src/game/zones-perimeter.ts packages/burger-client/test/zones-perimeter.test.ts
git commit -m "feat(client): zones-perimeter overlay module"
```

---

## Task 5: `game/index.ts` — initEditor for non-admins + wire perimeter + auto-exit

**Files:**

- Modify: `packages/burger-client/src/game/index.ts`

This task does three things in one commit:

1. Remove the `if (context.user.isAdmin)` gate around `initEditor` so non-admins also get the editor.
2. Initialize `PerimeterState` and subscribe to `myZoneCells` for redraws.
3. Auto-exit paint mode when `myZoneCells` transitions non-empty → empty for non-admins.

- [ ] **Step 1: Locate the admin gate around initEditor**

```bash
grep -n "if (context.user.isAdmin)" packages/burger-client/src/game/index.ts
```

Should find one match around line 793.

- [ ] **Step 2: Remove the gate; pass `myZoneCells` getters into `initEditor`**

In `packages/burger-client/src/game/index.ts`, find the block at line 793 and replace:

```ts
if (context.user.isAdmin) {
  context.editor = initEditor(
    context.app,
    context.assets.catalog,
    context.assets.tiles,
    context.network,
    context.containers.main,
    () => context.camera,
    () => ZOOM,
    useGameStore.getState().palette,
    {
      onTogglePaintMode: (mode) => {
        setZonesActive(context.zones, mode === "zone");
      },
    },
  );
  // ... (palette subscribe, zones subscribe — admin-only)
}
```

with (note: `initEditor` call moves OUT of the admin-only block; the admin-only zones subscriptions stay):

```ts
context.editor = initEditor(
  context.app,
  context.assets.catalog,
  context.assets.tiles,
  context.network,
  context.containers.main,
  () => context.camera,
  () => ZOOM,
  useGameStore.getState().palette,
  {
    onTogglePaintMode: (mode) => {
      // Zone-paint overlay is admin-only.
      if (context.user.isAdmin) {
        setZonesActive(context.zones, mode === "zone");
      }
    },
    getCanEnterPaintMode: () => {
      return canEnterPaintMode(
        context.user,
        useGameStore.getState().zones.myZoneCells,
      );
    },
    getCanPaintCell: (key: string) => {
      return canPaintCell(
        context.user,
        useGameStore.getState().zones.myZoneCells,
        key,
      );
    },
  },
);
useGameStore.getState().setEditor({
  active: false,
  selectedTileId: context.editor.selectedTileId,
});

// Palette subscription is universal (admins + non-admins).
let lastPalette = useGameStore.getState().palette;
const unsubscribePalette = useGameStore.subscribe((s) => {
  if (s.palette !== lastPalette && context.editor) {
    lastPalette = s.palette;
    setEditorPalette(context.editor, s.palette, context.assets.tiles);
  }
});
teardownCallbacks.push(unsubscribePalette);

if (context.user.isAdmin) {
  // Admin-only: zones overlay subscription.
  // ... (keep the existing zones subscription block here)
}
```

(Make sure the existing zones subscription block — the one for the admin overlay — is INSIDE the `if (context.user.isAdmin)` block. The palette subscription is OUTSIDE.)

Also add the imports at the top of `index.ts`:

```ts
import {
  initEditor,
  setEditorPalette,
  updateEditor,
  canEnterPaintMode,
  canPaintCell,
} from "./editor";
```

(Extend the existing editor import statement; don't add a new one.)

- [ ] **Step 3: Initialize perimeter overlay + subscribe to myZoneCells**

After the editor init (still in the same function, after the `setEditor(...)` call), add:

```ts
// Perimeter outline overlay for non-admin paint mode. Parented to
// mainContainer so it scrolls with the camera.
const perimeter = initPerimeter(context.containers.main);
context.perimeter = perimeter;

// Initial cells from store (could be empty).
setPerimeterCells(perimeter, useGameStore.getState().zones.myZoneCells);

let lastMyCells = useGameStore.getState().zones.myZoneCells;
const unsubscribeMyZones = useGameStore.subscribe((s) => {
  const next = s.zones.myZoneCells;
  if (next === lastMyCells) return;
  lastMyCells = next;
  setPerimeterCells(perimeter, next);
  // Auto-exit paint mode on zone loss for non-admins.
  if (
    !context.user.isAdmin &&
    next.size === 0 &&
    useGameStore.getState().editor.active &&
    context.editor
  ) {
    // Simulate an Escape press to exit cleanly.
    // The editor's keydown handler can't be invoked from here; instead we
    // mutate the editor state via the same code path.
    exitPaintMode(context.editor);
    useGameStore.getState().setEditorActive(false);
    setPerimeterVisible(perimeter, false);
  }
});
teardownCallbacks.push(unsubscribeMyZones);
```

Also extend imports:

```ts
import {
  initPerimeter,
  setPerimeterCells,
  setPerimeterVisible,
} from "./zones-perimeter";
```

The `exitPaintMode` function is a small helper we need in `editor.ts`. Add it now: in `packages/burger-client/src/game/editor.ts`, export a function:

```ts
export const exitPaintMode = (state: EditorState): void => {
  state.active = false;
  if (state.cursorSprite && state.cursorOutline) {
    state.cursorSprite.visible = false;
    state.cursorOutline.visible = false;
  }
};
```

And import in `index.ts`:

```ts
import {
  initEditor,
  setEditorPalette,
  updateEditor,
  canEnterPaintMode,
  canPaintCell,
  exitPaintMode,
} from "./editor";
```

- [ ] **Step 4: Make perimeter visible when paint mode toggles**

In the `onTogglePaintMode` callback (passed into `initEditor` in Step 2), add perimeter visibility toggle for non-admins:

```ts
    onTogglePaintMode: (mode) => {
      if (context.user.isAdmin) {
        setZonesActive(context.zones, mode === "zone");
      } else {
        // Non-admin: show perimeter only while tile-paint is active.
        setPerimeterVisible(perimeter, mode === "tile");
      }
    },
```

Note `perimeter` must be in scope inside the callback. Since the callback closes over the outer function, move the `const perimeter = initPerimeter(...)` BEFORE the `initEditor` call so it's in scope.

Reorganize: initialize `perimeter` BEFORE calling `initEditor`, then `initEditor`'s `onTogglePaintMode` callback can reference it.

- [ ] **Step 5: Add `perimeter` to the `Context` type**

In `packages/burger-client/src/game/index.ts`, find the `Context` type. Add:

```ts
perimeter: PerimeterState;
```

Import the type:

```ts
import {
  initPerimeter,
  setPerimeterCells,
  setPerimeterVisible,
  type PerimeterState,
} from "./zones-perimeter";
```

- [ ] **Step 6: Typecheck + lint + fmt**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -10 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3
```

Expected: 0 errors, 0 warnings.

Likely fix-ups: any place that referenced `context.editor` previously assumed it could be undefined for non-admins. Now `context.editor` is always set; the optional check (`if (!context.editor) return;`) still works (always truthy) but may now produce unreachable-code lint warnings. If so, leave them — they don't affect runtime.

- [ ] **Step 7: Commit**

```bash
git add packages/burger-client/src/game/editor.ts packages/burger-client/src/game/index.ts
git commit -m "feat(client): non-admin editor init + perimeter overlay + auto-exit"
```

---

## Task 6: Tile Picker window

**Files:**

- Create: `packages/burger-client/src/windows/TilePickerWindow.tsx`
- Modify: `packages/burger-client/src/windows/WindowManager.tsx`

- [ ] **Step 1: Create `TilePickerWindow.tsx`**

Create `packages/burger-client/src/windows/TilePickerWindow.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Window } from "./Window";
import { useGameStore } from "../store";
import { eden } from "../eden";

type CatalogEntry = {
  id: number;
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};

export const TilePickerWindow = () => {
  const palette = useGameStore((s) => s.palette);
  const setPalette = useGameStore((s) => s.setPalette);
  const atlasInfo = useGameStore((s) => s.atlasInfo);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    eden.api.catalog
      .get()
      .then((res) => {
        if (cancelled) return;
        if ("data" in res && Array.isArray(res.data)) {
          setCatalog(res.data as CatalogEntry[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!atlasInfo) {
    return null;
  }

  const togglePalette = async (id: number) => {
    const next = palette.includes(id)
      ? palette.filter((x) => x !== id)
      : [...palette, id];
    if (next.length > 9) {
      setError("Max 9 tiles in palette");
      return;
    }
    setError(null);
    // Optimistic update.
    setPalette(next);
    const res = await eden.api.palette.put({ ids: next });
    if (res.error) {
      // Revert.
      setPalette(palette);
      setError("Failed to save palette");
    }
  };

  return (
    <div
      style={{
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: "12px", color: "#888" }}>
        Right-click a tile to add/remove from your palette ({palette.length}/9)
      </div>
      {error && <div style={{ color: "#c33", fontSize: "12px" }}>{error}</div>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 64px)",
          gap: "8px",
          overflowY: "auto",
          flex: 1,
        }}
      >
        {catalog.map((entry) => {
          const inPalette = palette.includes(entry.id);
          return (
            <div
              key={entry.id}
              onContextMenu={(e) => {
                e.preventDefault();
                togglePalette(entry.id);
              }}
              style={{
                width: "64px",
                cursor: "context-menu",
                border: inPalette ? "2px solid #ffd966" : "2px solid #333",
                padding: "2px",
                userSelect: "none",
              }}
              title={entry.label}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  imageRendering: "pixelated",
                  backgroundImage: `url(${atlasInfo.url})`,
                  backgroundPosition: `-${entry.src_x}px -${entry.src_y}px`,
                  backgroundRepeat: "no-repeat",
                  margin: "0 auto",
                }}
              />
              <div
                style={{
                  fontSize: "10px",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {entry.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

Adjustments based on actual codebase:

- The `eden` import path may differ. Check what `Atlas.tsx` imports for `eden`.
- `setPalette` and the `palette` slice: check the actual store shape. Use whatever the existing setter is named (e.g. if it's `setPaletteIds` or similar, use that).
- `atlasInfo` field: check `useGameStore` shape for the right selector (it might be `s.atlas` or similar).
- If `catalog` shape is exposed via `eden.api.catalog.get()`, use it; otherwise fall back to `fetch("/api/catalog")`.

Look at `packages/burger-client/src/routes/Atlas.tsx` for the exact patterns.

- [ ] **Step 2: Register `WINDOW_TILE_PICKER` and render**

In `packages/burger-client/src/windows/WindowManager.tsx`:

a) Add the constant:

```ts
export const WINDOW_TILE_PICKER = "tile-picker";
```

b) Register in the `registerWindow` block (matching the pattern for other windows):

```ts
registerWindow(WINDOW_TILE_PICKER, {
  title: "Palette",
  x: 60,
  y: 100,
  w: 380,
  h: 480,
  open: false,
});
```

(Match the exact signature used for other windows.)

c) Render. Find where other window components are rendered (e.g. `<ZonesWindow />`) and add:

```tsx
import { TilePickerWindow } from "./TilePickerWindow";
```

```tsx
<Window id={WINDOW_TILE_PICKER}>
  <TilePickerWindow />
</Window>
```

d) Add `WINDOW_TILE_PICKER` to the admin `taskbarIds` array so admins can also open it:

```ts
const taskbarIds = isAdmin
  ? [WINDOW_ATLAS, WINDOW_SPAWN, WINDOW_BOTS, WINDOW_ZONES, WINDOW_TILE_PICKER]
  : [];
```

- [ ] **Step 3: Typecheck + lint + fmt + build**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3 && pnpm --filter burger-client build 2>&1 | tail -5
```

Expected: 0 errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/burger-client/src/windows/TilePickerWindow.tsx packages/burger-client/src/windows/WindowManager.tsx
git commit -m "feat(client): TilePickerWindow for palette curation (admin + non-admin)"
```

---

## Task 7: Non-admin HUD with Palette button

**Files:**

- Create: `packages/burger-client/src/windows/NonAdminHud.tsx`
- Modify: `packages/burger-client/src/windows/WindowManager.tsx`

- [ ] **Step 1: Create `NonAdminHud.tsx`**

Create `packages/burger-client/src/windows/NonAdminHud.tsx`:

```tsx
import { useGameStore } from "../store";
import { WINDOW_TILE_PICKER } from "./WindowManager";

export const NonAdminHud = () => {
  const user = useGameStore((s) => s.user);
  const myZoneCells = useGameStore((s) => s.zones.myZoneCells);
  const toggleWindow = useGameStore((s) => s.toggleWindow);

  if (!user || user.isAdmin) return null;
  if (myZoneCells.size === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "8px",
        left: "8px",
        display: "flex",
        gap: "6px",
        zIndex: 1000,
      }}
    >
      <button
        onClick={() => toggleWindow(WINDOW_TILE_PICKER)}
        style={{
          padding: "6px 12px",
          background: "#222",
          color: "#fff",
          border: "1px solid #444",
          cursor: "pointer",
          fontSize: "13px",
        }}
      >
        Palette
      </button>
    </div>
  );
};
```

Adjustments based on actual codebase:

- `toggleWindow` may be named differently in your store. Check the existing taskbar button code in `WindowManager.tsx` for the right call.
- The styling should ideally use existing CSS classes (look for `taskbar-button` in the project's style.css) for visual consistency.

- [ ] **Step 2: Render `<NonAdminHud />` from `WindowManager.tsx`**

In `packages/burger-client/src/windows/WindowManager.tsx`, find where the top-level layout is rendered (where the taskbar is rendered for admins). Add the import:

```tsx
import { NonAdminHud } from "./NonAdminHud";
```

And render unconditionally near the taskbar — the component itself handles the visibility check (returning null if admin or no zones):

```tsx
<NonAdminHud />
```

- [ ] **Step 3: Typecheck + lint + fmt + build**

```bash
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -3 && pnpm fmt:check 2>&1 | tail -3 && pnpm --filter burger-client build 2>&1 | tail -5
```

Expected: 0 errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/burger-client/src/windows/NonAdminHud.tsx packages/burger-client/src/windows/WindowManager.tsx
git commit -m "feat(client): non-admin HUD with Palette button (visible when zoned)"
```

---

## Final Verification

After Task 7, run the full verification pipeline:

```bash
pnpm --filter burger-server test 2>&1 | tail -5 && \
pnpm --filter burger-shared test 2>&1 | tail -5 && \
pnpm --filter burger-client test 2>&1 | tail -5 && \
pnpm lint 2>&1 | tail -3 && \
pnpm --filter burger-server exec tsc --noEmit 2>&1 | tail -3 && \
pnpm --filter burger-client exec tsc --noEmit 2>&1 | tail -3 && \
pnpm fmt:check 2>&1 | tail -3 && \
pnpm --filter burger-client build 2>&1 | tail -5
```

Expected: all tests pass, 0 lint warnings, 0 type errors, fmt clean, build succeeds.

End-to-end manual smoke (do this after deploy or against `pnpm dev`):

1. `pnpm dev`. Log in as admin in browser A, non-admin "alice" in browser B.
2. Admin: open Zones window, create "alice-zone", paint ~10 cells via `z` + click, assign Alice in member checkboxes.
3. Alice: HUD button "Palette" appears top-left. Click → Tile Picker window opens.
4. Alice: right-click 3 tiles in Tile Picker → border turns yellow.
5. Alice: press `e` → paint mode engages. Yellow perimeter outline visible around the zone. Cursor is white inside, red outside.
6. Alice: click inside zone → tile paints, visible to admin in browser A.
7. Alice: click outside zone → silent no-op (no tile).
8. Admin: remove Alice from the zone (uncheck her in members).
9. Alice: paint mode auto-exits. HUD button "Palette" disappears.
10. Alice: press `e` → no-op.
11. Admin: re-add Alice. HUD reappears, paint mode works again.
12. Kill dev server.
