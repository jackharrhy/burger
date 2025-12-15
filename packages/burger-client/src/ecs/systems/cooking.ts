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
import {
  CookingTimer,
  UncookedPatty,
  CookedPatty,
  Sprite,
  RigidBody,
  SittingOn,
  Stove,
  Holdable,
} from "../components";
import type { GameWorld } from "../world";
import debugFactory from "debug";
import * as Pixi from "pixi.js";
import { getEntityPosition } from "./physics";
import { debugContainer, showDebug } from "../../setup";
import {
  COOKING_DURATION,
  getCookingProgress,
  getCookingTint,
  isCookingComplete,
} from "@burger-king/shared";

const debug = debugFactory("burger:ecs:systems:cooking");

// Re-export for convenience
export { COOKING_DURATION } from "@burger-king/shared";

const debugTimerTexts = new Map<number, Pixi.Text>();

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
    // Any holdable item occupies the counter
    if (hasComponent(world, eid, Holdable)) {
      return true;
    }
  }
  return false;
};

export const setupCookingObservers = (world: GameWorld): void => {
  observe(world, onAdd(SittingOn(Wildcard)), (eid) => {
    const [counterEid] = getRelationTargets(world, eid, SittingOn);
    if (!counterEid) return;

    const stoveEid = getStoveOnCounter(world, counterEid);
    if (stoveEid === 0) return;

    if (
      hasComponent(world, eid, UncookedPatty) &&
      !isCounterOccupiedByItem(world, counterEid, eid)
    ) {
      debug("Starting cooking for patty %d on counter %d", eid, counterEid);
      addComponent(world, eid, CookingTimer);
      CookingTimer.duration[eid] = COOKING_DURATION;
    } else {
      debug("Not handling cooking for patty %d on counter %d", eid, counterEid);
    }
  });
};

const updateDebugTimerText = (
  pattyEid: number,
  elapsed: number,
  duration: number
): void => {
  if (!showDebug) {
    const existing = debugTimerTexts.get(pattyEid);
    if (existing) {
      existing.destroy();
      debugTimerTexts.delete(pattyEid);
    }
    return;
  }

  const pattyPos = getEntityPosition(pattyEid);
  const remaining = Math.max(0, duration - elapsed);
  const displayText = remaining.toFixed(1);

  let text = debugTimerTexts.get(pattyEid);
  if (!text) {
    text = new Pixi.Text({
      text: displayText,
      style: {
        fontFamily: "ComicSans",
        fontSize: 12,
        fill: 0xffff00,
        stroke: { color: 0x000000, width: 2 },
      },
    });
    text.anchor.set(0.5, 1);
    debugContainer.addChild(text);
    debugTimerTexts.set(pattyEid, text);
  }

  text.text = displayText;
  text.x = pattyPos.x;
  text.y = pattyPos.y - 12;
};

export const removeDebugTimerText = (pattyEid: number): void => {
  const text = debugTimerTexts.get(pattyEid);
  if (text) {
    text.destroy();
    debugTimerTexts.delete(pattyEid);
  }
};

export const cookingSystem = (world: GameWorld): void => {
  const { time } = world;

  for (const eid of query(world, [CookingTimer, UncookedPatty, RigidBody])) {
    CookingTimer.elapsed[eid] += time.delta;

    updateDebugTimerText(
      eid,
      CookingTimer.elapsed[eid],
      CookingTimer.duration[eid]
    );

    const progress = getCookingProgress(eid);
    const sprite = Sprite[eid];
    if (sprite) {
      sprite.tint = getCookingTint(progress);
    }

    if (isCookingComplete(eid)) {
      debug("Cooking complete for patty %d", eid);
      removeComponent(world, eid, UncookedPatty);
      removeComponent(world, eid, CookingTimer);
      addComponent(world, eid, CookedPatty);
      removeDebugTimerText(eid);

      CookingTimer.elapsed[eid] = 0;
      CookingTimer.duration[eid] = 0;

      if (sprite) {
        sprite.texture = Pixi.Assets.get("cooked-patty");
        sprite.tint = 0xffffff;
      }
    }
  }
};
