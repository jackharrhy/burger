import * as Pixi from "pixi.js";
import { TILE_HEIGHT, TILE_WIDTH } from "./vars";
import { Rapier, world, levelContainer, entityContainer } from "./setup";
import levelData from "./burger.json";
import { playerBody } from "./player";

export const createLevel = () => {
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

  playerBody.setNextKinematicTranslation({
    x: playerSpawn.__worldX,
    y: playerSpawn.__worldY,
  });

  const setupRigidBody = (x: number, y: number) => {
    const rigidBodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
      x + TILE_WIDTH / 2,
      y + TILE_HEIGHT / 2
    );
    const rigidBody = world.createRigidBody(rigidBodyDesc);

    const colliderDesc = Rapier.ColliderDesc.cuboid(
      TILE_WIDTH / 2,
      TILE_HEIGHT / 2
    );
    world.createCollider(colliderDesc, rigidBody);
  };

  const setupSprite = (
    x: number,
    y: number,
    spriteName: string,
    container: Pixi.Container,
    options: {
      anchor: number;
    }
  ) => {
    const sprite = new Pixi.Sprite(Pixi.Assets.get(spriteName));
    sprite.width = TILE_WIDTH;
    sprite.height = TILE_HEIGHT;
    sprite.anchor.set(options.anchor);
    sprite.x = x + TILE_WIDTH / 2;
    sprite.y = y + TILE_HEIGHT / 2;
    container.addChild(sprite);
  };

  const setupEntitySprite = (x: number, y: number, spriteName: string) => {
    setupSprite(x, y, spriteName, entityContainer, { anchor: 1 });
  };

  const setupLevelSprite = (x: number, y: number, spriteName: string) => {
    setupSprite(x, y, spriteName, levelContainer, { anchor: 0.5 });
  };

  entitiesLayer.entityInstances.forEach((entity) => {
    switch (entity.__identifier) {
      case "Stove":
        setupEntitySprite(entity.__worldX, entity.__worldY, "stove");
        break;
      case "Cooked_Patty":
        setupEntitySprite(entity.__worldX, entity.__worldY, "cooked-patty");
        break;
      case "Uncooked_Patty":
        setupEntitySprite(entity.__worldX, entity.__worldY, "uncooked-patty");
        break;
    }
  });

  worldLayer.gridTiles.forEach((tile) => {
    switch (tile.t) {
      case 0:
        setupLevelSprite(tile.px[0], tile.px[1], "red-brick");
        setupRigidBody(tile.px[0], tile.px[1]);
        break;
      case 1:
        setupLevelSprite(tile.px[0], tile.px[1], "black-floor");
        break;
      case 6:
        setupLevelSprite(tile.px[0], tile.px[1], "counter");
        setupRigidBody(tile.px[0], tile.px[1]);
        break;
    }
  });
};
