import { debugGraphics } from "./setup";

export const ASSETS_DIR = "/assets";
export const FONTS_DIR = `${ASSETS_DIR}/fonts`;
export const SPRITES_DIR = `${ASSETS_DIR}/sprites`;
export const SOUNDS_DIR = `${ASSETS_DIR}/sounds`;

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = TILE_WIDTH;

export const PLAYER_SIZE = TILE_WIDTH;
export const PLAYER_START_X = TILE_WIDTH * 3;
export const PLAYER_START_Y = TILE_WIDTH * 3;

export const LEVEL_DATA = [
  "=======",
  "=     =",
  "=     =",
  "=     =",
  "=     =",
  "=     =",
  "=======",
];

export const GRAVITY = { x: 0.0, y: 0.0 };

export const keys: { [key: string]: boolean } = {};

export let showDebug = true;

export const toggleDebugRender = () => {
  showDebug = !showDebug;
  if (!showDebug) {
    debugGraphics.clear();
  }
  console.log("showDebug", showDebug);
  return showDebug;
};

export let cameraOffset = { x: 0, y: 0 };
