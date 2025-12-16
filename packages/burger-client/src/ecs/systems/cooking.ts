import { query, hasComponent } from "bitecs";
import {
  Stove,
  SittingOn,
  Holdable,
  CookingTimer,
  Sprite,
  UncookedPatty,
} from "../components";
import { getCookingTint, COOKING_DURATION } from "@burger-king/shared";
import type { GameWorld } from "../world";

export const getStoveOnCounter = (
  world: GameWorld,
  counterEid: number
): number => {
  const stoves = query(world, [Stove, SittingOn(counterEid)]);
  return stoves.length > 0 ? stoves[0] : 0;
};

export const isCounterOccupiedByItem = (
  world: GameWorld,
  counterEid: number,
  excludeEid: number = 0
): boolean => {
  for (const eid of query(world, [SittingOn(counterEid)])) {
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
