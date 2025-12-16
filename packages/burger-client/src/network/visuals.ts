import { addEntity, addComponent } from "bitecs";
import * as Pixi from "pixi.js";
import {
  Sprite,
  RigidBody,
  Collider,
  CharacterController,
  Input,
  Position,
  InteractionZone,
  FollowsEntity,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { getRapierWorld } from "../ecs/systems/physics";
import {
  Rapier,
  playerContainer,
  debugContainer,
  entityContainer,
  levelContainer,
} from "../setup";
import {
  PLAYER_SIZE,
  TILE_SIZE,
  COLLISION_GROUP_PLAYER,
  COLLISION_GROUP_WALLS,
  COLLISION_GROUP_ITEMS,
  makeCollisionGroups,
} from "../vars";

export const addPlayerVisuals = (
  world: GameWorld,
  eid: number,
  isLocal: boolean
): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("player"));
  sprite.width = PLAYER_SIZE;
  sprite.height = PLAYER_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  if (!isLocal) {
    sprite.tint = 0xaaaaff;
  }
  playerContainer.addChild(sprite);
  Sprite[eid] = sprite;

  if (isLocal) {
    addComponent(world, eid, Input);
    addComponent(world, eid, RigidBody);
    addComponent(world, eid, Collider);
    addComponent(world, eid, CharacterController);

    const bodyDesc =
      Rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y);
    const rigidBody = rapierWorld.createRigidBody(bodyDesc);
    RigidBody[eid] = rigidBody;

    const colliderDesc = Rapier.ColliderDesc.cuboid(
      PLAYER_SIZE / 2,
      PLAYER_SIZE / 2
    ).setCollisionGroups(
      makeCollisionGroups(COLLISION_GROUP_PLAYER, COLLISION_GROUP_WALLS)
    );
    const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
    Collider[eid] = collider;

    const controller = rapierWorld.createCharacterController(0.01);
    controller.setUp({ x: 0.0, y: 1.0 });
    controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    CharacterController[eid] = controller;

    const debugEid = addEntity(world);
    addComponent(world, debugEid, Position);
    addComponent(world, debugEid, Sprite);
    addComponent(world, debugEid, InteractionZone);
    addComponent(world, debugEid, FollowsEntity);

    FollowsEntity.target[debugEid] = eid;
    FollowsEntity.offsetX[debugEid] = PLAYER_SIZE;
    FollowsEntity.offsetY[debugEid] = 0;

    Position.x[debugEid] = x + PLAYER_SIZE;
    Position.y[debugEid] = y;

    const debugSprite = new Pixi.Sprite(Pixi.Assets.get("debug"));
    debugSprite.width = PLAYER_SIZE;
    debugSprite.height = PLAYER_SIZE;
    debugSprite.anchor.set(0.5);
    debugSprite.alpha = 0.25;
    debugSprite.x = x + PLAYER_SIZE;
    debugSprite.y = y;
    debugContainer.addChild(debugSprite);
    Sprite[debugEid] = debugSprite;
  }
};

export const addItemVisuals = (
  world: GameWorld,
  eid: number,
  isCooked: boolean
): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const textureName = isCooked ? "cooked-patty" : "uncooked-patty";
  const sprite = new Pixi.Sprite(Pixi.Assets.get(textureName));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  entityContainer.addChild(sprite);
  Sprite[eid] = sprite;

  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(TILE_SIZE / 2, TILE_SIZE / 2)
    .setSensor(true)
    .setCollisionGroups(makeCollisionGroups(COLLISION_GROUP_ITEMS, 0));
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;
};

export const addStoveVisuals = (world: GameWorld, eid: number): void => {
  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("stove"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  entityContainer.addChild(sprite);
  Sprite[eid] = sprite;
};

export const addWallVisuals = (world: GameWorld, eid: number): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("red-brick"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_SIZE / 2,
    TILE_SIZE / 2
  ).setCollisionGroups(
    makeCollisionGroups(COLLISION_GROUP_WALLS, COLLISION_GROUP_PLAYER)
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;
};

export const addFloorVisuals = (world: GameWorld, eid: number): void => {
  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("black-floor"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;
};

export const addCounterVisuals = (world: GameWorld, eid: number): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("counter"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_SIZE / 2,
    TILE_SIZE / 2
  ).setCollisionGroups(
    makeCollisionGroups(COLLISION_GROUP_WALLS, COLLISION_GROUP_PLAYER)
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;
};

export const updateItemToCooked = (eid: number): void => {
  const sprite = Sprite[eid];
  if (!sprite) return;

  sprite.texture = Pixi.Assets.get("cooked-patty");
  sprite.tint = 0xffffff;
};

export const addBinVisuals = (world: GameWorld, eid: number): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("bin"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_SIZE / 2,
    TILE_SIZE / 2
  ).setCollisionGroups(
    makeCollisionGroups(COLLISION_GROUP_WALLS, COLLISION_GROUP_PLAYER)
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;
};

export const addPattyBoxVisuals = (world: GameWorld, eid: number): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("patty-box"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_SIZE / 2,
    TILE_SIZE / 2
  ).setCollisionGroups(
    makeCollisionGroups(COLLISION_GROUP_WALLS, COLLISION_GROUP_PLAYER)
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;
};

export const addOrderWindowVisuals = (world: GameWorld, eid: number): void => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  if (Sprite[eid]) return;

  const x = Position.x[eid];
  const y = Position.y[eid];

  addComponent(world, eid, Sprite);
  const sprite = new Pixi.Sprite(Pixi.Assets.get("order-window"));
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_SIZE / 2,
    TILE_SIZE / 2
  ).setCollisionGroups(
    makeCollisionGroups(COLLISION_GROUP_WALLS, COLLISION_GROUP_PLAYER)
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;
};

export const removeVisuals = (_world: GameWorld, eid: number): void => {
  const rapierWorld = getRapierWorld();

  const sprite = Sprite[eid];
  if (sprite) {
    sprite.destroy();
    Sprite[eid] = null;
  }

  if (rapierWorld) {
    const collider = Collider[eid];
    if (collider) {
      rapierWorld.removeCollider(collider, true);
      Collider[eid] = null;
    }

    const rigidBody = RigidBody[eid];
    if (rigidBody) {
      rapierWorld.removeRigidBody(rigidBody);
      RigidBody[eid] = null;
    }
  }
};
