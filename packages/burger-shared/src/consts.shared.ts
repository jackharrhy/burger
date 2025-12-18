export const PLAYER_SPEED = 250;
export const ACCELERATION = 0.016;
export const FRICTION = 0.015;
export const TILE_SIZE = 32;
export const PLAYER_SIZE = 30;

export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  YOUR_EID: 3,
  INPUT: 4,
  GAME_STATE: 5,
} as const;

export const TILE_TYPES = {
  FLOOR: 0,
  WALL: 1,
} as const;

export type TileType = typeof TILE_TYPES;
export const TICK_RATE_MS = 1000 / 60;
