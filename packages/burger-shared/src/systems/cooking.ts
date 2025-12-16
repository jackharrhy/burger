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

export const getStoveOnCounter = (world: any, counterEid: number): number => {
  const stoves = query(world, [Stove, SittingOn(counterEid)]);
  return stoves.length > 0 ? stoves[0] : 0;
};

export const isCounterOccupiedByItem = (
  world: any,
  counterEid: number,
  excludeEid: number = 0
): boolean => {
  for (const eid of query(world, [SittingOn(counterEid)])) {
    if (eid === excludeEid) continue;
    if (hasComponent(world, eid, Holdable)) return true;
  }
  return false;
};

export const setupCookingObservers = (world: any): void => {
  observe(world, onAdd(SittingOn(Wildcard)), (eid) => {
    const [counterEid] = getRelationTargets(world, eid, SittingOn);
    if (!counterEid) return;

    const stoveEid = getStoveOnCounter(world, counterEid);
    if (stoveEid === 0) return;

    if (
      hasComponent(world, eid, UncookedPatty) &&
      !isCounterOccupiedByItem(world, counterEid, eid)
    ) {
      if (!hasComponent(world, eid, CookingTimer)) {
        addComponent(world, eid, CookingTimer);
        CookingTimer.duration[eid] = COOKING_DURATION;
        CookingTimer.elapsed[eid] = 0;
        debug(
          "Cooking started: patty=%d counter=%d stove=%d",
          eid,
          counterEid,
          stoveEid
        );
      } else {
        debug(
          "Cooking resumed: patty=%d counter=%d elapsed=%d",
          eid,
          counterEid,
          CookingTimer.elapsed[eid]
        );
      }
    }
  });
};

export const cookingSystem = (world: any, deltaTime: number): void => {
  for (const eid of query(world, [
    CookingTimer,
    UncookedPatty,
    SittingOn(Wildcard),
  ])) {
    const [counterEid] = getRelationTargets(world, eid, SittingOn);
    if (!counterEid) continue;

    const stoveEid = getStoveOnCounter(world, counterEid);
    if (stoveEid === 0) continue;

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
