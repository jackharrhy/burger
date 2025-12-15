import { query, addComponent, removeComponent } from "bitecs";
import {
  CookingTimer,
  Position,
  Stove,
  UncookedPatty,
  CookedPatty,
  Sprite,
} from "../components";
import type { GameWorld } from "../world";
import * as Pixi from "pixi.js";

const COOKING_DURATION = 20.0;

export const cookingSystem = (world: GameWorld): void => {
  const { time } = world;

  for (const pattyEid of query(world, [UncookedPatty, Position])) {
    for (const stoveEid of query(world, [Stove, Position])) {
      const dx = Math.abs(Position.x[pattyEid] - Position.x[stoveEid]);
      const dy = Math.abs(Position.y[pattyEid] - Position.y[stoveEid]);

      if (dx < 16 && dy < 16) {
        if (!CookingTimer.duration[pattyEid]) {
          addComponent(world, pattyEid, CookingTimer);
          CookingTimer.elapsed[pattyEid] = 0;
          CookingTimer.duration[pattyEid] = COOKING_DURATION;
        }
      }
    }
  }

  for (const eid of query(world, [CookingTimer, UncookedPatty])) {
    CookingTimer.elapsed[eid] += time.delta;

    if (CookingTimer.elapsed[eid] >= CookingTimer.duration[eid]) {
      removeComponent(world, eid, UncookedPatty);
      removeComponent(world, eid, CookingTimer);
      addComponent(world, eid, CookedPatty);

      const sprite = Sprite[eid];
      if (sprite) {
        sprite.texture = Pixi.Assets.get("cooked-patty");
      }
    }
  }
};
