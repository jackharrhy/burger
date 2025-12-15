import "./style.css";

import { pixi, toggleDebug, world as rapierWorld } from "./setup";
import { createGameWorld } from "./ecs/world";
import {
  timeSystem,
  inputSystem,
  setupInputListeners,
  playerMovementSystem,
  runPhysicsWithAccumulator,
  setRapierWorld,
  interactionSystem,
  heldItemSystem,
  cameraSystem,
  renderSyncSystem,
  debugRenderSystem,
  interactionZoneDebugSystem,
  cookingSystem,
} from "./ecs/systems";
import { createLevel } from "./entities";

const gameWorld = createGameWorld();
setRapierWorld(rapierWorld);
setupInputListeners(gameWorld);

window.addEventListener("keydown", (e) => {
  if (e.key === "q") {
    toggleDebug();
  }
});

createLevel(gameWorld);

pixi.ticker.add(() => {
  // 1. Update time
  timeSystem(gameWorld);

  // 2. Read input
  inputSystem(gameWorld);

  // 3. Run physics with fixed timestep (includes movement)
  runPhysicsWithAccumulator(gameWorld, playerMovementSystem);

  // 4. Handle interactions (pickup/drop)
  interactionSystem(gameWorld);

  // 5. Update held items to follow player
  heldItemSystem(gameWorld);

  // 6. Update cooking timers
  cookingSystem(gameWorld);

  // 7. Sync render positions from physics
  renderSyncSystem(gameWorld);

  // 8. Update camera to follow player
  cameraSystem(gameWorld);

  // 9. Update interaction zone debug sprite
  interactionZoneDebugSystem(gameWorld);

  // 10. Render debug shapes
  debugRenderSystem(gameWorld);
});
