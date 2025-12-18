import { query, type World } from "bitecs";
import { PLAYER_SIZE, TILE_SIZE } from "./consts.shared";
import debug from "debug";
import type { sharedComponents } from "./ecs.shared";

const log = debug("burger:collision");

interface CollisionInfo {
  overlapX: number;
  overlapY: number;
  tileX: number;
  tileY: number;
  eid: number;
}

const EPSILON = 0.01;
const PLAYER_BUFFER = 0.5; // Small buffer to prevent edge catching

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
  const HALF_PLAYER = PLAYER_SIZE / 2 - PLAYER_BUFFER;

  const getOverlaps = (px: number, py: number): CollisionInfo[] => {
    const collisions: CollisionInfo[] = [];

    for (const eid of solidEntities) {
      const tileX = Position.x[eid];
      const tileY = Position.y[eid];

      const dx = Math.abs(px - tileX);
      const dy = Math.abs(py - tileY);

      const overlapX = HALF_PLAYER + HALF_TILE - dx;
      const overlapY = HALF_PLAYER + HALF_TILE - dy;

      if (overlapX > 0 && overlapY > 0) {
        collisions.push({ overlapX, overlapY, tileX, tileY, eid });
      }
    }

    return collisions;
  };

  // Calculate target position
  let targetX = x + vx * dt;
  let targetY = y + vy * dt;

  log(`=== MOVE AND SLIDE ===`);
  log(`Start: (${x.toFixed(2)}, ${y.toFixed(2)})`);
  log(`Velocity: (${vx.toFixed(3)}, ${vy.toFixed(3)})`);
  log(`Target: (${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);

  // Check collision at target position
  const collisions = getOverlaps(targetX, targetY);

  if (collisions.length === 0) {
    log(`No collision - moving to target`);
    return { x: targetX, y: targetY };
  }

  log(`Found ${collisions.length} collisions`);

  // Calculate combined push-out vectors for all collisions
  let totalPushX = 0;
  let totalPushY = 0;
  let primaryAxis = "x"; // 'x' or 'y'

  for (const collision of collisions) {
    const { overlapX, overlapY, tileX, tileY } = collision;
    log(
      `Collision: overlapX=${overlapX.toFixed(2)}, overlapY=${overlapY.toFixed(2)}`,
    );

    if (overlapX < overlapY) {
      // X-axis collision is primary
      const pushDirection = targetX < tileX ? -1 : 1;
      totalPushX += (overlapX + EPSILON) * pushDirection;
      primaryAxis = "x";
    } else {
      // Y-axis collision is primary
      const pushDirection = targetY < tileY ? -1 : 1;
      totalPushY += (overlapY + EPSILON) * pushDirection;
      if (primaryAxis === "x") primaryAxis = "mixed";
    }
  }

  let finalX = targetX;
  let finalY = targetY;

  if (primaryAxis === "x") {
    // Primary X-axis collisions - resolve horizontally
    finalX = targetX + totalPushX;
    log(
      `Primary X-axis collision: pushing horizontally by ${totalPushX.toFixed(2)}`,
    );

    // Try to slide along Y axis with multiple attempts
    let slideSuccessful = false;
    const slideAttempts = [1.0, 0.75, 0.5, 0.25]; // Try different slide amounts

    for (const slideAmount of slideAttempts) {
      const slideY = y + (targetY - y) * slideAmount;
      const slideCollisions = getOverlaps(finalX, slideY);

      if (slideCollisions.length === 0) {
        log(
          `Slide successful on Y axis with ${(slideAmount * 100).toFixed(0)}% movement`,
        );
        finalY = slideY;
        slideSuccessful = true;
        break;
      }
    }

    if (!slideSuccessful) {
      log(`All slide attempts failed on Y axis, keeping original Y`);
      finalY = y;
    }
  } else if (primaryAxis === "y") {
    // Primary Y-axis collisions - resolve vertically
    finalY = targetY + totalPushY;
    log(
      `Primary Y-axis collision: pushing vertically by ${totalPushY.toFixed(2)}`,
    );

    // Try to slide along X axis with multiple attempts
    let slideSuccessful = false;
    const slideAttempts = [1.0, 0.75, 0.5, 0.25]; // Try different slide amounts

    for (const slideAmount of slideAttempts) {
      const slideX = x + (targetX - x) * slideAmount;
      const slideCollisions = getOverlaps(slideX, finalY);

      if (slideCollisions.length === 0) {
        log(
          `Slide successful on X axis with ${(slideAmount * 100).toFixed(0)}% movement`,
        );
        finalX = slideX;
        slideSuccessful = true;
        break;
      }
    }

    if (!slideSuccessful) {
      log(`All slide attempts failed on X axis, keeping original X`);
      finalX = x;
    }
  } else {
    // Mixed collisions - resolve both axes
    finalX = targetX + totalPushX;
    finalY = targetY + totalPushY;
    log(
      `Mixed collisions: pushing X by ${totalPushX.toFixed(2)}, Y by ${totalPushY.toFixed(2)}`,
    );
  }

  // Final safety check - if still colliding, use more aggressive resolution
  const finalCollisions = getOverlaps(finalX, finalY);
  if (finalCollisions.length > 0) {
    log(`Still colliding after slide - applying aggressive resolution`);

    // Push out of all collisions
    for (const collision of finalCollisions) {
      if (collision.overlapX < collision.overlapY) {
        const pushDir = finalX < collision.tileX ? -1 : 1;
        finalX += (collision.overlapX + EPSILON * 2) * pushDir;
      } else {
        const pushDir = finalY < collision.tileY ? -1 : 1;
        finalY += (collision.overlapY + EPSILON * 2) * pushDir;
      }
    }
  }

  log(`Final position: (${finalX.toFixed(2)}, ${finalY.toFixed(2)})`);
  log(
    `Movement delta: (${(finalX - x).toFixed(2)}, ${(finalY - y).toFixed(2)})`,
  );
  log(`========================`);

  return { x: finalX, y: finalY };
};
