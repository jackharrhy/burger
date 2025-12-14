import * as Pixi from "pixi.js";
import { TILE_HEIGHT, TILE_WIDTH } from "./vars";
import { Rapier, world, levelContainer, entityContainer } from "./setup";
import levelData from "./burger.json";
import { playerBody } from "./player";
import type RAPIER from "@dimforge/rapier2d-compat";

export const entityColliderRegistry = new Map<
  RAPIER.Collider,
  { type: string; sprite: Pixi.Sprite }
>();

export const counterColliderRegistry = new Map<
  RAPIER.Collider,
  { x: number; y: number }
>();

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

  const setupRigidBody = (x: number, y: number, isCounter: boolean = false) => {
    const rigidBodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
      x + TILE_WIDTH / 2,
      y + TILE_HEIGHT / 2
    );
    const rigidBody = world.createRigidBody(rigidBodyDesc);

    const colliderDesc = Rapier.ColliderDesc.cuboid(
      TILE_WIDTH / 2,
      TILE_HEIGHT / 2
    );
    const collider = world.createCollider(colliderDesc, rigidBody);

    if (isCounter) {
      counterColliderRegistry.set(collider, { x, y });
    }
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

  const setupLevelSprite = (x: number, y: number, spriteName: string) => {
    setupSprite(x, y, spriteName, levelContainer, { anchor: 0.5 });
  };

  const setupEntityWithCollider = (
    x: number,
    y: number,
    spriteName: string,
    entityType: string
  ) => {
    const sprite = new Pixi.Sprite(Pixi.Assets.get(spriteName));
    sprite.width = TILE_WIDTH;
    sprite.height = TILE_HEIGHT;
    sprite.anchor.set(1);
    sprite.x = x + TILE_WIDTH / 2;
    sprite.y = y + TILE_HEIGHT / 2;
    entityContainer.addChild(sprite);

    // With anchor 1 (bottom-right), sprite visual center is at (x, y)
    // Position rigid body to match sprite's visual center
    const rigidBodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
    const rigidBody = world.createRigidBody(rigidBodyDesc);

    const colliderDesc = Rapier.ColliderDesc.cuboid(
      TILE_WIDTH / 2,
      TILE_HEIGHT / 2
    );
    const collider = world.createCollider(colliderDesc, rigidBody);

    entityColliderRegistry.set(collider, { type: entityType, sprite });
  };

  entitiesLayer.entityInstances.forEach((entity) => {
    switch (entity.__identifier) {
      case "Stove":
        setupEntityWithCollider(
          entity.__worldX,
          entity.__worldY,
          "stove",
          "Stove"
        );
        break;
      case "Cooked_Patty":
        setupEntityWithCollider(
          entity.__worldX,
          entity.__worldY,
          "cooked-patty",
          "Cooked_Patty"
        );
        break;
      case "Uncooked_Patty":
        setupEntityWithCollider(
          entity.__worldX,
          entity.__worldY,
          "uncooked-patty",
          "Uncooked_Patty"
        );
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
        setupRigidBody(tile.px[0], tile.px[1], true);
        break;
    }
  });
};
