import { query, getRelationTargets } from "bitecs";
import {
  Position,
  Holdable,
  Counter,
  HeldBy,
  getInteractionPosition,
  calculateOverlapArea,
  MIN_OVERLAP_AREA,
  isCounterOccupiedByItem,
} from "@burger-king/shared";
import type { ServerWorld } from "./world";
import { getItemId } from "./sync";

export type BestHoldableResult = {
  eid: number;
  itemId: string;
  x: number;
  y: number;
} | null;

export type BestCounterResult = {
  eid: number;
  x: number;
  y: number;
  occupied: boolean;
} | null;

export const findBestHoldable = (
  world: ServerWorld,
  playerX: number,
  playerY: number,
  facingX: number,
  facingY: number,
  excludeEid: number = 0
): BestHoldableResult => {
  const interactionPos = getInteractionPosition(
    playerX,
    playerY,
    facingX,
    facingY
  );

  let best: BestHoldableResult = null;
  let maxOverlapArea = 0;

  for (const eid of query(world, [Holdable, Position])) {
    if (eid === excludeEid) continue;

    // Skip if already held
    const [heldByEid] = getRelationTargets(world, eid, HeldBy);
    if (heldByEid) continue;

    const entityPos = { x: Position.x[eid], y: Position.y[eid] };
    const overlapArea = calculateOverlapArea(interactionPos, entityPos);
    if (overlapArea < MIN_OVERLAP_AREA) continue;

    if (overlapArea > maxOverlapArea) {
      maxOverlapArea = overlapArea;
      const itemId = getItemId(eid);
      if (itemId) {
        best = { eid, itemId, x: entityPos.x, y: entityPos.y };
      }
    }
  }

  return best;
};

export const findBestCounter = (
  world: ServerWorld,
  playerX: number,
  playerY: number,
  facingX: number,
  facingY: number
): BestCounterResult => {
  const interactionPos = getInteractionPosition(
    playerX,
    playerY,
    facingX,
    facingY
  );

  let bestCounter: BestCounterResult = null;
  let bestUnoccupied: BestCounterResult = null;
  let maxOverlapArea = 0;
  let maxUnoccupiedOverlapArea = 0;

  for (const eid of query(world, [Counter, Position])) {
    const entityPos = { x: Position.x[eid], y: Position.y[eid] };
    const overlapArea = calculateOverlapArea(interactionPos, entityPos);
    if (overlapArea < MIN_OVERLAP_AREA) continue;

    const occupied = isCounterOccupiedByItem(world, eid);

    if (overlapArea > maxOverlapArea) {
      maxOverlapArea = overlapArea;
      bestCounter = { eid, x: entityPos.x, y: entityPos.y, occupied };
    }

    if (!occupied && overlapArea > maxUnoccupiedOverlapArea) {
      maxUnoccupiedOverlapArea = overlapArea;
      bestUnoccupied = { eid, x: entityPos.x, y: entityPos.y, occupied: false };
    }
  }

  // Fallback to unoccupied if overlap is significant
  if (bestCounter?.occupied && bestUnoccupied) {
    if (maxUnoccupiedOverlapArea / maxOverlapArea > 0.6) {
      return bestUnoccupied;
    }
  }

  return bestCounter;
};
