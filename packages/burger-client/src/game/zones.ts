import { Container, Graphics } from "pixi.js";
import { TILE_SIZE } from "burger-shared";

export type ZonesGameState = {
  active: boolean;
  selectedZoneId: number | null;
  cellsByZone: Map<number, [number, number][]>;
  overlay: Graphics;
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
  };
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
