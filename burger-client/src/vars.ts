import { debugGraphics } from "./setup";

export const ASSETS_DIR = "/assets";
export const FONTS_DIR = `${ASSETS_DIR}/fonts`;
export const SPRITES_DIR = `${ASSETS_DIR}/sprites`;
export const SOUNDS_DIR = `${ASSETS_DIR}/sounds`;

export const TILE_WIDTH = 32;
export const TILE_HEIGHT = TILE_WIDTH;

export const PLAYER_SIZE = TILE_WIDTH / 1.25;
export const PLAYER_SPEED = 240;

export const GRAVITY = { x: 0.0, y: 0.0 };

export const keys: { [key: string]: boolean } = {};

export let showDebug = true;

export const toggleDebugRender = () => {
  showDebug = !showDebug;
  if (!showDebug) {
    debugGraphics.clear();
  }
  return showDebug;
};

export let cameraOffset = { x: 0, y: 0 };
export const CAMERA_ZOOM = 2.0;
