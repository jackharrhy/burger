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
  networkPositionSyncSystem,
  heldItemSyncSystem,
  cameraSystem,
  renderSyncSystem,
  debugRenderSystem,
  interactionZoneDebugSystem,
  cookingVisualsSystem,
} from "./ecs/systems";
import { connect, isConnected, getLocalPlayerEid, sendMove } from "./network";
import { FacingDirection } from "./ecs/components";
import { getEntityPosition } from "./ecs/systems/physics";

const startGame = async () => {
  const gameWorld = createGameWorld();
  setRapierWorld(rapierWorld);
  setupInputListeners(gameWorld);

  window.addEventListener("keydown", (e) => {
    if (e.key === "q") {
      toggleDebug();
    }
  });

  try {
    await connect(gameWorld);
    console.log("Connected to multiplayer server");
  } catch (error) {
    console.error("Failed to connect to server:", error);
    return;
  }

  pixi.ticker.add(() => {
    // 1. Update time
    timeSystem(gameWorld);

    // 2. Read input
    inputSystem(gameWorld);

    // 3. Run physics with fixed timestep (includes movement)
    runPhysicsWithAccumulator(gameWorld, playerMovementSystem);

    // 4. Send position to server (only for local player)
    sendNetworkInput();

    // 5. Handle interactions (pickup/drop)
    interactionSystem(gameWorld);

    // 6. Update held item positions for local player (optimistic)
    heldItemSyncSystem(gameWorld);

    // 7. Sync network positions to rigid bodies (except local player)
    networkPositionSyncSystem(gameWorld);

    // 8. Update cooking visuals
    cookingVisualsSystem(gameWorld);

    // 9. Sync render positions from physics
    renderSyncSystem(gameWorld);

    // 10. Update camera to follow player
    cameraSystem(gameWorld);

    // 11. Update interaction zone debug sprite
    interactionZoneDebugSystem(gameWorld);

    // 12. Render debug shapes
    debugRenderSystem(gameWorld);
  });
};

const sendNetworkInput = (): void => {
  if (!isConnected()) return;

  const playerEid = getLocalPlayerEid();
  if (!playerEid) return;

  const pos = getEntityPosition(playerEid);
  const facingX = FacingDirection.x[playerEid];
  const facingY = FacingDirection.y[playerEid];

  sendMove(pos.x, pos.y, facingX, facingY);
};

startGame();
