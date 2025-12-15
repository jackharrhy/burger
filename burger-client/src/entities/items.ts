import { addEntity, addComponent, query } from "bitecs";
import * as Pixi from "pixi.js";
import {
  Holdable,
  Stove,
  Counter,
  SittingOn,
  UncookedPatty,
  CookedPatty,
  Sprite,
  RigidBody,
  Collider,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { getRapierWorld, getEntityPosition } from "../ecs/systems/physics";
import { Rapier, entityContainer } from "../setup";
import { TILE_WIDTH, TILE_HEIGHT } from "../vars";

export const findCounterAtPosition = (
  world: GameWorld,
  x: number,
  y: number
): number => {
  for (const counterEid of query(world, [Counter, RigidBody])) {
    if (Stove[counterEid]) continue;

    const counterPos = getEntityPosition(counterEid);
    const dx = Math.abs(counterPos.x - x);
    const dy = Math.abs(counterPos.y - y);

    if (dx < TILE_WIDTH / 2 && dy < TILE_HEIGHT / 2) {
      return counterEid;
    }
  }
  return 0;
};

export const linkStovesToCounters = (world: GameWorld): void => {
  for (const stoveEid of query(world, [Stove, RigidBody])) {
    const stovePos = getEntityPosition(stoveEid);
    const counterEid = findCounterAtPosition(world, stovePos.x, stovePos.y);

    if (counterEid !== 0) {
      addComponent(world, stoveEid, SittingOn(counterEid));
    }
  }
};

export const linkPattiesToCounters = (world: GameWorld): void => {
  for (const pattyEid of query(world, [Holdable, RigidBody])) {
    const pattyPos = getEntityPosition(pattyEid);
    const counterEid = findCounterAtPosition(world, pattyPos.x, pattyPos.y);

    if (counterEid !== 0) {
      addComponent(world, pattyEid, SittingOn(counterEid));
    }
  }
};

export const createStove = (world: GameWorld, x: number, y: number): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Stove);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

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

  addComponent(world, eid, Holdable);
  addComponent(world, eid, UncookedPatty);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

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

  addComponent(world, eid, Holdable);
  addComponent(world, eid, CookedPatty);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);

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
