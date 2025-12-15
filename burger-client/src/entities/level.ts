import type { GameWorld } from "../ecs/world";
import levelData from "../burger.json";
import { createPlayer } from "./player";
import { createWall, createCounter, createFloor } from "./tiles";
import { createStove, createUncookedPatty, createCookedPatty } from "./items";

let playerEntityId: number | null = null;

export const getPlayerEntityId = (): number | null => playerEntityId;

export const createLevel = (world: GameWorld): void => {
  const level = levelData.levels[0];

  const entitiesLayer = level.layerInstances.find(
    (layer) => layer.__identifier === "Entities"
  );
  if (!entitiesLayer) {
    throw new Error("Entities layer not found");
  }

  const worldLayer = level.layerInstances.find(
    (layer) => layer.__identifier === "World"
  );
  if (!worldLayer) {
    throw new Error("World layer not found");
  }

  const playerSpawn = entitiesLayer.entityInstances.find(
    (entity) => entity.__identifier === "Player"
  );
  if (!playerSpawn) {
    throw new Error("Player spawn not found");
  }

  playerEntityId = createPlayer(
    world,
    playerSpawn.__worldX,
    playerSpawn.__worldY
  );

  for (const entity of entitiesLayer.entityInstances) {
    switch (entity.__identifier) {
      case "Stove":
        createStove(world, entity.__worldX, entity.__worldY);
        break;
      case "Cooked_Patty":
        createCookedPatty(world, entity.__worldX, entity.__worldY);
        break;
      case "Uncooked_Patty":
        createUncookedPatty(world, entity.__worldX, entity.__worldY);
        break;
    }
  }

  for (const tile of worldLayer.gridTiles) {
    switch (tile.t) {
      case 0: // Wall (red-brick)
        createWall(world, tile.px[0], tile.px[1], "red-brick");
        break;
      case 1: // Floor (black-floor)
        createFloor(world, tile.px[0], tile.px[1], "black-floor");
        break;
      case 6: // Counter
        createCounter(world, tile.px[0], tile.px[1]);
        break;
    }
  }
};
