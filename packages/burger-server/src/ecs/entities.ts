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
  Stove,
  Player,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "@burger-king/shared";
import type { ServerWorld } from "./world";
import { hashItemId, registerItemMapping, registerPlayerMapping } from "./sync";

export const createServerItem = (
  world: ServerWorld,
  itemId: string,
  itemType: "uncooked_patty" | "cooked_patty",
  x: number,
  y: number,
  counterEid: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Holdable);
  addComponent(world, eid, NetworkId);

  Position.x[eid] = x;
  Position.y[eid] = y;
  NetworkId.id[eid] = hashItemId(itemId);

  if (itemType === "uncooked_patty") {
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

  addComponent(world, eid, Position);
  addComponent(world, eid, FacingDirection);
  addComponent(world, eid, Player);

  Position.x[eid] = x;
  Position.y[eid] = y;
  FacingDirection.x[eid] = 1;
  FacingDirection.y[eid] = 0;

  registerPlayerMapping(sessionId, eid);

  return eid;
};

export const createServerStove = (
  world: ServerWorld,
  x: number,
  y: number,
  counterEid: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Stove);
  addComponent(world, eid, SittingOn(counterEid));

  // Position at center to match counter and item positions
  Position.x[eid] = x + TILE_WIDTH / 2;
  Position.y[eid] = y + TILE_HEIGHT / 2;

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

  // Position at center to match client physics and item positions
  Position.x[eid] = x + TILE_WIDTH / 2;
  Position.y[eid] = y + TILE_HEIGHT / 2;

  return eid;
};
