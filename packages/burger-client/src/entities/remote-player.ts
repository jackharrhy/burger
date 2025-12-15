import { addEntity, addComponent, removeEntity } from "bitecs";
import * as Pixi from "pixi.js";
import {
  Player,
  Sprite,
  Position,
  FacingDirection,
  NetworkId,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { playerContainer } from "../setup";
import { PLAYER_SIZE } from "../vars";

const remotePlayerEntities = new Map<string, number>();

export const createRemotePlayer = (
  world: GameWorld,
  sessionId: string,
  x: number,
  y: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, Position);
  addComponent(world, eid, FacingDirection);
  addComponent(world, eid, NetworkId);

  Position.x[eid] = x;
  Position.y[eid] = y;
  FacingDirection.x[eid] = 1;
  FacingDirection.y[eid] = 0;

  NetworkId.id[eid] = hashSessionId(sessionId);

  const sprite = new Pixi.Sprite(Pixi.Assets.get("player"));
  sprite.width = PLAYER_SIZE;
  sprite.height = PLAYER_SIZE;
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;

  sprite.tint = 0xaaaaff;
  playerContainer.addChild(sprite);
  Sprite[eid] = sprite;

  remotePlayerEntities.set(sessionId, eid);

  return eid;
};

export const removeRemotePlayer = (
  world: GameWorld,
  sessionId: string
): void => {
  const eid = remotePlayerEntities.get(sessionId);
  if (eid === undefined) return;

  const sprite = Sprite[eid];
  if (sprite) {
    sprite.destroy();
    Sprite[eid] = null;
  }

  removeEntity(world, eid);
  remotePlayerEntities.delete(sessionId);
};

export const updateRemotePlayerPosition = (
  sessionId: string,
  x: number,
  y: number,
  facingX: number,
  facingY: number
): void => {
  const eid = remotePlayerEntities.get(sessionId);
  if (eid === undefined) return;

  Position.x[eid] = x;
  Position.y[eid] = y;
  FacingDirection.x[eid] = facingX;
  FacingDirection.y[eid] = facingY;

  const sprite = Sprite[eid];
  if (sprite) {
    sprite.x = x;
    sprite.y = y;
  }
};

export const getRemotePlayerEid = (sessionId: string): number | undefined => {
  return remotePlayerEntities.get(sessionId);
};

const hashSessionId = (sessionId: string): number => {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash << 5) - hash + sessionId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};
