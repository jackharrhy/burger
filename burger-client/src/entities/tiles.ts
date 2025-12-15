import { addEntity, addComponent } from "bitecs";
import * as Pixi from "pixi.js";
import {
  Position,
  Wall,
  Counter,
  Floor,
  Sprite,
  RigidBody,
  Collider,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { getRapierWorld } from "../ecs/systems/physics";
import { Rapier, levelContainer } from "../setup";
import { TILE_WIDTH, TILE_HEIGHT } from "../vars";

export const createWall = (
  world: GameWorld,
  x: number,
  y: number,
  spriteName: string = "red-brick"
): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Wall);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const centerX = x + TILE_WIDTH / 2;
  const centerY = y + TILE_HEIGHT / 2;
  Position.x[eid] = centerX;
  Position.y[eid] = centerY;

  const sprite = new Pixi.Sprite(Pixi.Assets.get(spriteName));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = centerX;
  sprite.y = centerY;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
    centerX,
    centerY
  );
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_WIDTH / 2,
    TILE_HEIGHT / 2
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;

  return eid;
};

export const createCounter = (
  world: GameWorld,
  x: number,
  y: number
): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Counter);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  const centerX = x + TILE_WIDTH / 2;
  const centerY = y + TILE_HEIGHT / 2;
  Position.x[eid] = centerX;
  Position.y[eid] = centerY;

  const sprite = new Pixi.Sprite(Pixi.Assets.get("counter"));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = centerX;
  sprite.y = centerY;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
    centerX,
    centerY
  );
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_WIDTH / 2,
    TILE_HEIGHT / 2
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;

  return eid;
};

export const createFloor = (
  world: GameWorld,
  x: number,
  y: number,
  spriteName: string = "black-floor"
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Floor);
  addComponent(world, eid, Sprite);

  const centerX = x + TILE_WIDTH / 2;
  const centerY = y + TILE_HEIGHT / 2;
  Position.x[eid] = centerX;
  Position.y[eid] = centerY;

  const sprite = new Pixi.Sprite(Pixi.Assets.get(spriteName));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = centerX;
  sprite.y = centerY;
  levelContainer.addChild(sprite);
  Sprite[eid] = sprite;

  return eid;
};
