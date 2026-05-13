import { Container, Graphics } from "pixi.js";
import { TILE_SIZE } from "burger-shared";
import { eden } from "../eden";

export type ZonesGameState = {
  active: boolean;
  selectedZoneId: number | null;
  cellsByZone: Map<number, [number, number][]>;
  overlay: Graphics;
  // Stroke accumulator. Mouse-down + drag fills these sets with the
  // cell-center keys `"x,y"` the user has touched this stroke; mouse-up
  // flushes them to the server via PUT /api/zones/:id/cells. Left-click
  // adds, right-click removes. Kept on local state (not the React store)
  // because the redraw path is driven by the WS `ZONES_UPDATED` echo, not
  // by optimistic local updates.
  pendingAdd: Set<string>;
  pendingRemove: Set<string>;
  isDragging: boolean;
  dragButton: "left" | "right" | null;
};

// Golden-angle hue spread so even adjacent zone ids get visually distinct
// colors. Sat=0.6, light=0.5 inlined as HSL→RGB so we don't pull a color lib
// in for a single function.
const zoneColor = (id: number): number => {
  const hue = (id * 137.5) % 360;
  const h = hue / 60;
  const c = 0.4; // chroma at sat=0.6, light=0.5: 2*0.5*0.6 = 0.6 — using 0.4 for less screaming.
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (h < 1) [r, g, b] = [c, x, 0];
  else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x];
  else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = 0.3;
  return (
    (Math.round((r + m) * 255) << 16) |
    (Math.round((g + m) * 255) << 8) |
    Math.round((b + m) * 255)
  );
};

// `parent` is the world-space container (mainContainer in startGame). Zones
// are drawn in world coords and must pan/zoom with the camera, so they have
// to live under the same transform as the tile sprites — NOT app.stage.
export const initZonesGame = (parent: Container): ZonesGameState => {
  const overlay = new Graphics();
  parent.addChild(overlay);
  overlay.visible = false;
  return {
    active: false,
    selectedZoneId: null,
    cellsByZone: new Map(),
    overlay,
    pendingAdd: new Set(),
    pendingRemove: new Set(),
    isDragging: false,
    dragButton: null,
  };
};

// Start a fresh stroke. Caller is responsible for checking
// `state.active` and `state.selectedZoneId !== null` first.
export const beginZoneStroke = (
  state: ZonesGameState,
  button: "left" | "right",
): void => {
  state.isDragging = true;
  state.dragButton = button;
  state.pendingAdd.clear();
  state.pendingRemove.clear();
};

// Push a cell-center coordinate into the appropriate pending set for the
// current stroke. (x, y) must already be snapped to the cell center —
// `${x},${y}` is used as the dedup key. No-op when not dragging.
export const extendZoneStroke = (
  state: ZonesGameState,
  x: number,
  y: number,
): void => {
  if (!state.isDragging || state.dragButton === null) return;
  const key = `${x},${y}`;
  if (state.dragButton === "left") state.pendingAdd.add(key);
  else state.pendingRemove.add(key);
};

// Finish the stroke: build add/remove arrays and PUT them. Server will
// broadcast `ZONES_UPDATED`, which triggers `refetchZones` and ultimately
// `setZoneCells` → the overlay redraw. No local optimistic update.
export const endZoneStroke = async (
  state: ZonesGameState,
  zoneId: number,
): Promise<void> => {
  state.isDragging = false;
  state.dragButton = null;
  const add = [...state.pendingAdd].map(
    (k) => k.split(",").map(Number) as [number, number],
  );
  const remove = [...state.pendingRemove].map(
    (k) => k.split(",").map(Number) as [number, number],
  );
  state.pendingAdd.clear();
  state.pendingRemove.clear();
  if (add.length === 0 && remove.length === 0) return;
  const { error } = await eden.api
    .zones({ id: zoneId })
    .cells.put({ add, remove });
  if (error) {
    console.error("zone cells PUT failed", error);
  }
};

export const setZonesActive = (
  state: ZonesGameState,
  active: boolean,
): void => {
  state.active = active;
  state.overlay.visible = active;
  if (active) redrawZonesOverlay(state);
};

export const setZonesData = (
  state: ZonesGameState,
  cellsByZone: Map<number, [number, number][]>,
  selectedZoneId: number | null,
): void => {
  state.cellsByZone = cellsByZone;
  state.selectedZoneId = selectedZoneId;
  if (state.active) redrawZonesOverlay(state);
};

export const redrawZonesOverlay = (state: ZonesGameState): void => {
  const g = state.overlay;
  g.clear();
  const halfTile = TILE_SIZE / 2;
  for (const [zoneId, cells] of state.cellsByZone) {
    const color = zoneColor(zoneId);
    const alpha = zoneId === state.selectedZoneId ? 0.5 : 0.2;
    for (const [x, y] of cells) {
      g.rect(x - halfTile, y - halfTile, TILE_SIZE, TILE_SIZE).fill({
        color,
        alpha,
      });
    }
  }
};
