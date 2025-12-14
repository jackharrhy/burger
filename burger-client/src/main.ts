import "./style.css";

import {
  debugGraphics,
  pixi,
  showDebug,
  sounds,
  toggleDebug,
  world,
  worldContainer,
} from "./setup";
import {
  cameraOffset,
  CAMERA_ZOOM,
  holdableItems,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "./vars";
import {
  debugSprite,
  dropItem,
  handleInteraction,
  heldItem,
  interactableCollider,
  pickupItem,
  playerBody,
  playerSprite,
  updateInteractablePosition,
  updatePlayerMovement,
} from "./player";
import { createLevel, entityColliderRegistry } from "./level";

export const playCounterSound = () => {
  sounds.counter.play();
};

const renderDebugShapes = () => {
  debugGraphics.clear();

  if (!showDebug) {
    return;
  }

  const { vertices, colors } = world.debugRender();

  for (let i = 0; i < vertices.length / 4; i += 1) {
    const vertexIndex = i * 4;
    const colorIndex = i * 8;

    const color = [
      colors[colorIndex],
      colors[colorIndex + 1],
      colors[colorIndex + 2],
      colors[colorIndex + 3],
    ];

    debugGraphics
      .setStrokeStyle({ width: 2, color })
      .moveTo(vertices[vertexIndex], vertices[vertexIndex + 1])
      .lineTo(vertices[vertexIndex + 2], vertices[vertexIndex + 3])
      .stroke();
  }
};

window.addEventListener("keydown", (e) => {
  if (e.key === "q") {
    toggleDebug();
  }
  if (e.key === " " || e.key === "Space") {
    e.preventDefault();
    if (heldItem) {
      // If holding an item, first check for items to pick up (for swap)
      const intersectingColliders = handleInteraction();
      let swapped = false;

      for (const collider of intersectingColliders) {
        const entityInfo = entityColliderRegistry.get(collider);
        if (
          entityInfo &&
          holdableItems.includes(
            entityInfo.type as (typeof holdableItems)[number]
          )
        ) {
          // Found an item to swap with - pick it up (which will drop current at its position)
          if (pickupItem(collider)) {
            swapped = true;
            break;
          }
        }
      }

      // If no swap happened, try to drop on a counter
      if (!swapped) {
        dropItem();
      }
    } else {
      // If not holding, check for items to pick up
      const intersectingColliders = handleInteraction();
      for (const collider of intersectingColliders) {
        if (pickupItem(collider)) {
          break; // Only pick up one item at a time
        }
      }
    }
  }
});

const PHYSICS_TIMESTEP = 1 / 60;
let accumulator = 0;

createLevel();

pixi.ticker.add((ticker) => {
  const deltaTime = ticker.deltaTime;
  accumulator += deltaTime / 60;

  while (accumulator >= PHYSICS_TIMESTEP) {
    updatePlayerMovement(PHYSICS_TIMESTEP);

    world.step();
    accumulator -= PHYSICS_TIMESTEP;
  }

  const playerPos = playerBody.translation();
  playerSprite.x = playerPos.x;
  playerSprite.y = playerPos.y;

  updateInteractablePosition();
  const interactablePos = interactableCollider.translation();
  debugSprite.x = interactablePos.x;
  debugSprite.y = interactablePos.y;

  // Update held item position to match interactable area
  // With anchor 1 (bottom-right), sprite position needs offset to center visually
  if (heldItem) {
    heldItem.rigidBody.setTranslation(
      {
        x: interactablePos.x,
        y: interactablePos.y,
      },
      true
    );
    // Sprite position = center + half tile size (to account for anchor 1)
    heldItem.sprite.x = interactablePos.x + TILE_WIDTH / 2;
    heldItem.sprite.y = interactablePos.y + TILE_HEIGHT / 2;
  }

  cameraOffset.x = playerSprite.x - pixi.screen.width / 2 / CAMERA_ZOOM;
  cameraOffset.y = playerSprite.y - pixi.screen.height / 2 / CAMERA_ZOOM;

  worldContainer.scale.set(CAMERA_ZOOM);
  worldContainer.x = -cameraOffset.x * CAMERA_ZOOM;
  worldContainer.y = -cameraOffset.y * CAMERA_ZOOM;

  renderDebugShapes();
});
