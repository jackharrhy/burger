import { World, Settings } from "planck";

// Physics world singleton
let physicsWorld: World | null = null;

export const getPhysicsWorld = (): World => {
  if (!physicsWorld) {
    Settings.maxTranslation = 1000; // Allow high velocities without position clamping
    physicsWorld = new World({
      gravity: { x: 0, y: 0 } // No gravity for top-down game
    });
  }
  return physicsWorld;
};

export const destroyPhysicsWorld = (): void => {
  physicsWorld = null;
};