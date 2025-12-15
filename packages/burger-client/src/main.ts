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
} from "./ecs/systems";
import { createLevel, getPlayerEntityId } from "./entities";
import {
  connect,
  setupPlayerSync,
  setupItemSync,
  initOptimistic,
  networkInputSystem,
} from "./network";

const startGame = async () => {
  const gameWorld = createGameWorld();
  setRapierWorld(rapierWorld);
  setupInputListeners(gameWorld);

  window.addEventListener("keydown", (e) => {
    if (e.key === "q") {
      toggleDebug();
    }
  });

  createLevel(gameWorld);

  // Initialize optimistic updates with player entity
  const playerEid = getPlayerEntityId();
  if (playerEid !== null) {
    initOptimistic(gameWorld, playerEid);
  }

  try {
    const room = await connect();
    setupPlayerSync(room, gameWorld);
    setupItemSync(room, gameWorld);
    console.log("Connected to multiplayer server");
  } catch (error) {
    console.warn(
      "Failed to connect to server, running in offline mode:",
      error
    );
  }

  pixi.ticker.add(() => {
    // 1. Update time
    timeSystem(gameWorld);

    // 2. Read input
    inputSystem(gameWorld);

    // 3. Send input to server
    networkInputSystem(gameWorld);

    // 4. Run physics with fixed timestep (includes movement)
    runPhysicsWithAccumulator(gameWorld, playerMovementSystem);

    // 5. Handle interactions (pickup/drop)
    interactionSystem(gameWorld);

    // 6. Update held items to follow player
    heldItemSystem(gameWorld);

    // 7. Sync render positions from physics
    renderSyncSystem(gameWorld);

    // 8. Update camera to follow player
    cameraSystem(gameWorld);

    // 9. Update interaction zone debug sprite
    interactionZoneDebugSystem(gameWorld);

    // 10. Render debug shapes
    debugRenderSystem(gameWorld);
  });
};

startGame();
