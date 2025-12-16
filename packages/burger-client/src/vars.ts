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

export { TILE_WIDTH as TILE_SIZE } from "@burger-king/shared";

export const ASSETS_DIR = "/assets";
export const FONTS_DIR = `${ASSETS_DIR}/fonts`;
export const SPRITES_DIR = `${ASSETS_DIR}/sprites`;
export const SOUNDS_DIR = `${ASSETS_DIR}/sounds`;

export const CAMERA_ZOOM = 2.75;

export const COLLISION_GROUP_PLAYER = 0x0001;
export const COLLISION_GROUP_WALLS = 0x0002;
export const COLLISION_GROUP_ITEMS = 0x0004;

export const makeCollisionGroups = (
  membership: number,
  filter: number
): number => (membership << 16) | filter;
