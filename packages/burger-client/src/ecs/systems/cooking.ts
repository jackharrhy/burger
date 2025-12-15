import { query, hasComponent } from "bitecs";
import { Stove, SittingOn, Holdable } from "../components";
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
