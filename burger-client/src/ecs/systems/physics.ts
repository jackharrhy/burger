import type RAPIER from "@dimforge/rapier2d-compat";
import type { GameWorld } from "../world";

let rapierWorld: RAPIER.World | null = null;

export const setRapierWorld = (world: RAPIER.World): void => {
  rapierWorld = world;
};

export const getRapierWorld = (): RAPIER.World | null => rapierWorld;

export const physicsSystem = (_world: GameWorld): void => {
  if (rapierWorld) {
    rapierWorld.step();
  }
};

export const runPhysicsWithAccumulator = (
  world: GameWorld,
  movementSystem: (world: GameWorld, timeStep: number) => void
): number => {
  const { physics, time } = world;
  physics.accumulator += time.delta;

  let steps = 0;
  while (physics.accumulator >= physics.timestep) {
    movementSystem(world, physics.timestep);
    physicsSystem(world);
    physics.accumulator -= physics.timestep;
    steps++;
  }

  return steps;
};
