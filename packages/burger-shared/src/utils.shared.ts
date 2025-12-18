import { query } from "bitecs";
import {
  ACCELERATION,
  FRICTION,
  PLAYER_SPEED,
  TILE_SIZE,
} from "./consts.shared";
import { Position, Solid } from "./ecs.shared";
import type { World } from "./types.shared";

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * Math.min(t, 1);

export const applyInputToVelocity = (
  vx: number,
  vy: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
): { vx: number; vy: number } => {
  let targetX = 0;
  let targetY = 0;

  if (input.left) targetX -= 1;
  if (input.right) targetX += 1;
  if (input.up) targetY -= 1;
  if (input.down) targetY += 1;

  if (targetX !== 0 && targetY !== 0) {
    const len = Math.sqrt(targetX * targetX + targetY * targetY);
    targetX /= len;
    targetY /= len;
  }

  targetX *= PLAYER_SPEED;
  targetY *= PLAYER_SPEED;

  const isMoving = targetX !== 0 || targetY !== 0;
  const blend = isMoving ? ACCELERATION : FRICTION;

  return {
    vx: lerp(vx, targetX, blend * dt),
    vy: lerp(vy, targetY, blend * dt),
  };
};

export const applyVelocityToPosition = (
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  return {
    x: x + vx * dt,
    y: y + vy * dt,
  };
};

export const moveAndSlide = (
  world: World,
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  const newX = x + vx * dt;
  const newY = y + vy * dt;
  const playerSize = 15;
  let collidedX = false;
  let collidedY = false;
  for (const eid of query(world, [Solid, Position])) {
    const sx = Position.x[eid]!;
    const sy = Position.y[eid]!;
    const size = TILE_SIZE / 2;
    if (
      Math.abs(newX - sx) < playerSize + size &&
      Math.abs(y - sy) < playerSize + size
    ) {
      collidedX = true;
    }
    if (
      Math.abs(x - sx) < playerSize + size &&
      Math.abs(newY - sy) < playerSize + size
    ) {
      collidedY = true;
    }
  }
  return {
    x: collidedX ? x : newX,
    y: collidedY ? y : newY,
  };
};
