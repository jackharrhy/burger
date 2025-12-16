import {
  query,
  addComponent,
  removeComponent,
  observe,
  onAdd,
  getRelationTargets,
  Wildcard,
  hasComponent,
} from "bitecs";
import debugFactory from "debug";
import {
  CookingTimer,
  UncookedPatty,
  CookedPatty,
  SittingOn,
  Stove,
  Holdable,
  COOKING_DURATION,
} from "../index";

const debug = debugFactory("burger:shared:cooking");

/**
 * Check if a surface is occupied by a holdable item
 */
export const isSurfaceOccupiedByItem = (
  world: any,
  surfaceEid: number,
  excludeEid: number = 0
): boolean => {
  for (const eid of query(world, [SittingOn(surfaceEid)])) {
    if (eid === excludeEid) continue;
    if (hasComponent(world, eid, Holdable)) return true;
  }
  return false;
};

// Backwards compatibility alias
export const isCounterOccupiedByItem = isSurfaceOccupiedByItem;

export const setupCookingObservers = (world: any): void => {
  observe(world, onAdd(SittingOn(Wildcard)), (eid) => {
    const [targetEid] = getRelationTargets(world, eid, SittingOn);
    if (!targetEid) return;

    // Simplified: directly check if sitting on a stove
    if (!hasComponent(world, targetEid, Stove)) return;

    if (hasComponent(world, eid, UncookedPatty)) {
      if (!hasComponent(world, eid, CookingTimer)) {
        addComponent(world, eid, CookingTimer);
        CookingTimer.duration[eid] = COOKING_DURATION;
        CookingTimer.elapsed[eid] = 0;
        debug("Cooking started: patty=%d stove=%d", eid, targetEid);
      } else {
        debug(
          "Cooking resumed: patty=%d stove=%d elapsed=%d",
          eid,
          targetEid,
          CookingTimer.elapsed[eid]
        );
      }
    }
  });
};

export const cookingSystem = (world: any, deltaTime: number): void => {
  // Query for patties with cooking timer sitting on something
  for (const eid of query(world, [
    CookingTimer,
    UncookedPatty,
    SittingOn(Wildcard),
  ])) {
    const [targetEid] = getRelationTargets(world, eid, SittingOn);
    if (!targetEid) continue;

    // Simplified: directly check if sitting on a stove
    if (!hasComponent(world, targetEid, Stove)) continue;

    CookingTimer.elapsed[eid] += deltaTime;

    if (CookingTimer.elapsed[eid] >= CookingTimer.duration[eid]) {
      debug("Cooking complete: patty=%d", eid);
      removeComponent(world, eid, UncookedPatty);
      removeComponent(world, eid, CookingTimer);
      addComponent(world, eid, CookedPatty);
      CookingTimer.elapsed[eid] = 0;
      CookingTimer.duration[eid] = 0;
    }
  }
};
