import "./style.css";

import { debugGraphics, pixi, sounds, world, worldContainer } from "./setup";
import {
  cameraOffset,
  CAMERA_ZOOM,
  PLAYER_SIZE,
  showDebug,
  toggleDebugRender,
} from "./vars";
import {
  debugSprite,
  lastMoveDirection,
  playerBody,
  playerSprite,
  updatePlayerMovement,
} from "./player";
import { createLevel } from "./level";

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
    toggleDebugRender();
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

  if (lastMoveDirection) {
    debugSprite.x = playerSprite.x + lastMoveDirection.x * PLAYER_SIZE;
    debugSprite.y = playerSprite.y + lastMoveDirection.y * PLAYER_SIZE;
  } else {
    debugSprite.x = playerSprite.x;
    debugSprite.y = playerSprite.y;
  }

  cameraOffset.x = playerSprite.x - pixi.screen.width / 2 / CAMERA_ZOOM;
  cameraOffset.y = playerSprite.y - pixi.screen.height / 2 / CAMERA_ZOOM;

  worldContainer.scale.set(CAMERA_ZOOM);
  worldContainer.x = -cameraOffset.x * CAMERA_ZOOM;
  worldContainer.y = -cameraOffset.y * CAMERA_ZOOM;

  renderDebugShapes();
});
