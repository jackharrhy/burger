// Re-export shared constants
export {
  TILE_WIDTH,
  TILE_HEIGHT,
  PLAYER_SIZE,
  PLAYER_SPEED,
  COOKING_DURATION,
  GRAVITY,
  MIN_OVERLAP_THRESHOLD,
  holdableItems,
} from "@burger-king/shared";

// Client-specific constants (asset paths)
export const ASSETS_DIR = "/assets";
export const FONTS_DIR = `${ASSETS_DIR}/fonts`;
export const SPRITES_DIR = `${ASSETS_DIR}/sprites`;
export const SOUNDS_DIR = `${ASSETS_DIR}/sounds`;

export const CAMERA_ZOOM = 2.75;
