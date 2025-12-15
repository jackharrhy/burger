import { addEntity, addComponent } from "bitecs";
import * as Pixi from "pixi.js";
import {
  Position,
  Holdable,
  HeldBy,
  Stove,
  UncookedPatty,
  CookedPatty,
  Sprite,
  RigidBody,
  Collider,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { getRapierWorld } from "../ecs/systems/physics";
import { Rapier, entityContainer } from "../setup";
import { TILE_WIDTH, TILE_HEIGHT } from "../vars";

export const createStove = (world: GameWorld, x: number, y: number): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Stove);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  Position.x[eid] = x;
  Position.y[eid] = y;

  const sprite = new Pixi.Sprite(Pixi.Assets.get("stove"));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = x + TILE_WIDTH / 2;
  sprite.y = y + TILE_HEIGHT / 2;
  entityContainer.addChild(sprite);
  Sprite[eid] = sprite;

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
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

export const createUncookedPatty = (
  world: GameWorld,
  x: number,
  y: number
): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Holdable);
  addComponent(world, eid, HeldBy);
  addComponent(world, eid, UncookedPatty);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  Position.x[eid] = x;
  Position.y[eid] = y;

  HeldBy.holder[eid] = 0;

  const sprite = new Pixi.Sprite(Pixi.Assets.get("uncooked-patty"));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = x + TILE_WIDTH / 2;
  sprite.y = y + TILE_HEIGHT / 2;
  entityContainer.addChild(sprite);
  Sprite[eid] = sprite;

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
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

export const createCookedPatty = (
  world: GameWorld,
  x: number,
  y: number
): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Holdable);
  addComponent(world, eid, HeldBy);
  addComponent(world, eid, CookedPatty);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

  Position.x[eid] = x;
  Position.y[eid] = y;

  HeldBy.holder[eid] = 0;

  const sprite = new Pixi.Sprite(Pixi.Assets.get("cooked-patty"));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = x + TILE_WIDTH / 2;
  sprite.y = y + TILE_HEIGHT / 2;
  entityContainer.addChild(sprite);
  Sprite[eid] = sprite;

  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(x, y);
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
