import { query, type World } from "bitecs";
import { PLAYER_SIZE, TILE_SIZE } from "./const.shared";
import type { sharedComponents } from "./ecs.shared";

const CORNER_CORRECTION = 2;

export const moveAndSlide = (
  world: World<{ components: typeof sharedComponents }>,
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  const { Position, Solid } = world.components;
  const solidEntities = query(world, [Position, Solid]);

  const HALF_TILE = TILE_SIZE / 2;
  const HALF_PLAYER = PLAYER_SIZE / 2;

  const hasCollision = (px: number, py: number): boolean => {
    for (const eid of solidEntities) {
      const tileX = Position.x[eid];
      const tileY = Position.y[eid];
      const overlapX = HALF_PLAYER + HALF_TILE - Math.abs(px - tileX);
      const overlapY = HALF_PLAYER + HALF_TILE - Math.abs(py - tileY);
      if (overlapX > 0 && overlapY > 0) return true;
    }
    return false;
  };

  let newX = x + vx * dt;
  let newY = y;

  if (vx !== 0 && hasCollision(newX, newY)) {
    for (let nudge = 1; nudge <= CORNER_CORRECTION; nudge++) {
      if (!hasCollision(newX, newY - nudge)) {
        newY -= nudge;
        break;
      }
      if (!hasCollision(newX, newY + nudge)) {
        newY += nudge;
        break;
      }
    }
  }

  for (const eid of solidEntities) {
    const tileX = Position.x[eid];
    const tileY = Position.y[eid];
    const overlapX = HALF_PLAYER + HALF_TILE - Math.abs(newX - tileX);
    const overlapY = HALF_PLAYER + HALF_TILE - Math.abs(newY - tileY);
    if (overlapX > 0 && overlapY > 0) {
      if (newX < tileX) {
        newX -= overlapX;
      } else {
        newX += overlapX;
      }
    }
  }

  newY = newY + vy * dt;

  if (vy !== 0 && hasCollision(newX, newY)) {
    for (let nudge = 1; nudge <= CORNER_CORRECTION; nudge++) {
      if (!hasCollision(newX - nudge, newY)) {
        newX -= nudge;
        break;
      }
      if (!hasCollision(newX + nudge, newY)) {
        newX += nudge;
        break;
      }
    }
  }

  for (const eid of solidEntities) {
    const tileX = Position.x[eid];
    const tileY = Position.y[eid];
    const overlapX = HALF_PLAYER + HALF_TILE - Math.abs(newX - tileX);
    const overlapY = HALF_PLAYER + HALF_TILE - Math.abs(newY - tileY);
    if (overlapX > 0 && overlapY > 0) {
      if (newY < tileY) {
        newY -= overlapY;
      } else {
        newY += overlapY;
      }
    }
  }

  return { x: newX, y: newY };
};
