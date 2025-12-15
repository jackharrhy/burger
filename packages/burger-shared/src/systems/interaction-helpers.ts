import {
  TILE_WIDTH,
  TILE_HEIGHT,
  PLAYER_SIZE,
  MIN_OVERLAP_THRESHOLD,
} from "../constants";

export const MIN_OVERLAP_AREA =
  TILE_WIDTH * TILE_HEIGHT * MIN_OVERLAP_THRESHOLD;

export const getInteractionPosition = (
  playerX: number,
  playerY: number,
  facingX: number,
  facingY: number
): { x: number; y: number } => ({
  x: playerX + facingX * PLAYER_SIZE,
  y: playerY + facingY * PLAYER_SIZE,
});

export const calculateOverlapArea = (
  pos1: { x: number; y: number },
  pos2: { x: number; y: number },
  halfExtents1: { x: number; y: number } = {
    x: PLAYER_SIZE / 2,
    y: PLAYER_SIZE / 2,
  },
  halfExtents2: { x: number; y: number } = {
    x: TILE_WIDTH / 2,
    y: TILE_HEIGHT / 2,
  }
): number => {
  const left = Math.max(pos1.x - halfExtents1.x, pos2.x - halfExtents2.x);
  const right = Math.min(pos1.x + halfExtents1.x, pos2.x + halfExtents2.x);
  const bottom = Math.max(pos1.y - halfExtents1.y, pos2.y - halfExtents2.y);
  const top = Math.min(pos1.y + halfExtents1.y, pos2.y + halfExtents2.y);

  if (right > left && top > bottom) {
    return (right - left) * (top - bottom);
  }
  return 0;
};
