import { cookingSystem as sharedCookingSystem } from "@burger-king/shared";
import type { ServerWorld } from "../world";

export const cookingSystem = (world: ServerWorld, deltaTime: number): void => {
  sharedCookingSystem(world, deltaTime);
};
