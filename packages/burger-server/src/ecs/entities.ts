import { addEntity, addComponent } from "bitecs";
import {
  Position,
  FacingDirection,
  Holdable,
  UncookedPatty,
  CookedPatty,
  NetworkId,
  SittingOn,
  Counter,
  Wall,
  Floor,
  Player,
  Networked,
  Surface,
  AcceptsItems,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "@burger-king/shared";
import type { ServerWorld } from "./world";
import { registerItemMapping, registerPlayerMapping } from "./sync";

// Re-export entity factory for new entity types
export {
  createEntityFromRegistry,
  isRegisteredEntityType,
  type EntityConfig,
} from "./entity-factory";

export const createServerItem = (
  world: ServerWorld,
  itemId: string,
  itemType: "uncooked-patty" | "cooked-patty",
  x: number,
  y: number,
  counterEid: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Holdable);
  addComponent(world, eid, NetworkId);
  addComponent(world, eid, Networked);

  Position.x[eid] = x;
  Position.y[eid] = y;
  NetworkId.id[eid] = itemId;

  if (itemType === "uncooked-patty") {
    addComponent(world, eid, UncookedPatty);
  } else {
    addComponent(world, eid, CookedPatty);
  }

  if (counterEid) {
    addComponent(world, eid, SittingOn(counterEid));
  }

  registerItemMapping(itemId, eid);

  return eid;
};

export const createServerPlayer = (
  world: ServerWorld,
  sessionId: string,
  x: number,
  y: number
): number => {
  const eid = addEntity(world);
  const networkId = `player-${sessionId}`;

  addComponent(world, eid, Position);
  addComponent(world, eid, FacingDirection);
  addComponent(world, eid, Player);
  addComponent(world, eid, NetworkId);
  addComponent(world, eid, Networked);

  Position.x[eid] = x;
  Position.y[eid] = y;
  FacingDirection.x[eid] = 1;
  FacingDirection.y[eid] = 0;
  NetworkId.id[eid] = networkId;

  registerPlayerMapping(sessionId, eid, networkId);

  return eid;
};

export const createServerCounter = (
  world: ServerWorld,
  x: number,
  y: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Counter);
  addComponent(world, eid, NetworkId);
  addComponent(world, eid, Networked);

  // Surface behavior components - counters accept items
  addComponent(world, eid, Surface);
  addComponent(world, eid, AcceptsItems);

  Position.x[eid] = x + TILE_WIDTH / 2;
  Position.y[eid] = y + TILE_HEIGHT / 2;
  NetworkId.id[eid] = `counter-${x}-${y}`;

  return eid;
};

export const createServerWall = (
  world: ServerWorld,
  x: number,
  y: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Wall);
  addComponent(world, eid, Networked);

  Position.x[eid] = x + TILE_WIDTH / 2;
  Position.y[eid] = y + TILE_HEIGHT / 2;

  return eid;
};

export const createServerFloor = (
  world: ServerWorld,
  x: number,
  y: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Floor);
  addComponent(world, eid, Networked);

  Position.x[eid] = x + TILE_WIDTH / 2;
  Position.y[eid] = y + TILE_HEIGHT / 2;

  return eid;
};
