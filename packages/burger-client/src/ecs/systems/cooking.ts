import { query, hasComponent } from "bitecs";
import {
  SittingOn,
  Holdable,
  CookingTimer,
  Sprite,
  UncookedPatty,
} from "../components";
import { getCookingTint, COOKING_DURATION } from "@burger-king/shared";
import type { GameWorld } from "../world";

/**
 * Check if a surface is occupied by a holdable item
 */
export const isSurfaceOccupiedByItem = (
  world: GameWorld,
  surfaceEid: number,
  excludeEid: number = 0
): boolean => {
  for (const eid of query(world, [SittingOn(surfaceEid)])) {
    if (eid === excludeEid) continue;
    if (hasComponent(world, eid, Holdable)) {
      return true;
    }
  }
  return false;
};

export const cookingVisualsSystem = (world: GameWorld): void => {
  for (const eid of query(world, [CookingTimer, UncookedPatty])) {
    const sprite = Sprite[eid];
    if (!sprite) continue;

    const elapsed = CookingTimer.elapsed[eid];
    const duration = CookingTimer.duration[eid] || COOKING_DURATION;
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

    sprite.tint = getCookingTint(progress);
  }
};
