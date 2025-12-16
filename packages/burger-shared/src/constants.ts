export const TILE_WIDTH = 32;
export const TILE_HEIGHT = TILE_WIDTH;

export const PLAYER_SIZE = TILE_WIDTH / 1.25;
export const PLAYER_SPEED = 200;

export const COOKING_DURATION = 15.0;

export const GRAVITY = { x: 0.0, y: 0.0 };

export const MIN_OVERLAP_THRESHOLD = 0.1;

export const holdableItems = ["Cooked_Patty", "Uncooked_Patty"] as const;
