export const SERVER_TICK_RATE_MS = 1000 / 60;
export const CLIENT_UPDATE_RATE = 1000 / 60;

export const PLAYER_SPEED = 0.2;
export const ACCELERATION = 0.012;
export const FRICTION = 0.015;
export const TILE_SIZE = 32;
export const PLAYER_SIZE = TILE_SIZE - 8;

export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  YOUR_EID: 3,
  INPUT: 4,
  GAME_STATE: 5,
  PING: 6,
  PONG: 7,
  SIGNAL: 8,
} as const;

export const TILE_TYPES = {
  FLOOR: 0,
  WALL: 1,
  COUNTER: 2,
} as const;

export type TileType = (typeof TILE_TYPES)[keyof typeof TILE_TYPES];
