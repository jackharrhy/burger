import { query, getRelationTargets, hasComponent } from "bitecs";
import {
  Position,
  Holdable,
  Surface,
  HeldBy,
  AcceptsItems,
  DestroysItems,
  SpawnsItems,
  AcceptsOrders,
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

export type BestSurfaceResult = {
  eid: number;
  x: number;
  y: number;
  occupied: boolean;
  acceptsItems: boolean;
  destroysItems: boolean;
  spawnsItems: boolean;
  acceptsOrders: boolean;
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

export const findBestSurface = (
  world: ServerWorld,
  playerX: number,
  playerY: number,
  facingX: number,
  facingY: number
): BestSurfaceResult => {
  const interactionPos = getInteractionPosition(
    playerX,
    playerY,
    facingX,
    facingY
  );

  let bestSurface: BestSurfaceResult = null;
  let bestUnoccupied: BestSurfaceResult = null;
  let maxOverlapArea = 0;
  let maxUnoccupiedOverlapArea = 0;

  for (const eid of query(world, [Surface, Position])) {
    const entityPos = { x: Position.x[eid], y: Position.y[eid] };
    const overlapArea = calculateOverlapArea(interactionPos, entityPos);
    if (overlapArea < MIN_OVERLAP_AREA) continue;

    const occupied = isCounterOccupiedByItem(world, eid);
    const acceptsItems = hasComponent(world, eid, AcceptsItems);
    const destroysItems = hasComponent(world, eid, DestroysItems);
    const spawnsItems = hasComponent(world, eid, SpawnsItems);
    const acceptsOrders = hasComponent(world, eid, AcceptsOrders);

    const result: BestSurfaceResult = {
      eid,
      x: entityPos.x,
      y: entityPos.y,
      occupied,
      acceptsItems,
      destroysItems,
      spawnsItems,
      acceptsOrders,
    };

    if (overlapArea > maxOverlapArea) {
      maxOverlapArea = overlapArea;
      bestSurface = result;
    }

    if (!occupied && overlapArea > maxUnoccupiedOverlapArea) {
      maxUnoccupiedOverlapArea = overlapArea;
      bestUnoccupied = { ...result, occupied: false };
    }
  }

  // Prefer unoccupied surfaces when holding an item (for dropping)
  if (bestSurface?.occupied && bestUnoccupied) {
    if (maxUnoccupiedOverlapArea / maxOverlapArea > 0.6) {
      return bestUnoccupied;
    }
  }

  return bestSurface;
};
