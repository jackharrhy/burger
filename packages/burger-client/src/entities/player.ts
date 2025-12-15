import { addEntity, addComponent } from "bitecs";
import * as Pixi from "pixi.js";
import {
  FacingDirection,
  Input,
  Player,
  Sprite,
  RigidBody,
  Collider,
  CharacterController,
  FollowsEntity,
  InteractionZone,
  Position,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { getRapierWorld } from "../ecs/systems/physics";
import { Rapier, playerContainer, debugContainer } from "../setup";
import { PLAYER_SIZE } from "../vars";

export const createPlayer = (
  world: GameWorld,
  x: number,
  y: number,
): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, FacingDirection);
  addComponent(world, eid, Input);
  addComponent(world, eid, Player);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);
  addComponent(world, eid, CharacterController);

  FacingDirection.x[eid] = 1;
  FacingDirection.y[eid] = 0;

  const sprite = new Pixi.Sprite(Pixi.Assets.get("player"));
  sprite.width = PLAYER_SIZE;
  sprite.height = PLAYER_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  playerContainer.addChild(sprite);
  Sprite[eid] = sprite;

  const bodyDesc = Rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
    x,
    y,
  );
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    PLAYER_SIZE / 2,
    PLAYER_SIZE / 2,
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

  return eid;
};
