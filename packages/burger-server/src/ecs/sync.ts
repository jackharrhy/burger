import { query, getRelationTargets, hasComponent } from "bitecs";
import {
  Position,
  FacingDirection,
  CookingTimer,
  HeldBy,
  SittingOn,
  UncookedPatty,
  CookedPatty,
  Holdable,
} from "@burger-king/shared";
import type { ServerWorld } from "./world";
import type { ItemSchema, PlayerSchema } from "@burger-king/shared";

// Map: server item ID → ECS entity ID
const itemIdToEid = new Map<string, number>();
const eidToItemId = new Map<number, string>();

// Map: session ID → ECS entity ID
const sessionIdToEid = new Map<string, number>();
const eidToSessionId = new Map<number, string>();

export const registerItemMapping = (itemId: string, eid: number): void => {
  itemIdToEid.set(itemId, eid);
  eidToItemId.set(eid, itemId);
};

export const registerPlayerMapping = (sessionId: string, eid: number): void => {
  sessionIdToEid.set(sessionId, eid);
  eidToSessionId.set(eid, sessionId);
};

export const unregisterItemMapping = (itemId: string): void => {
  const eid = itemIdToEid.get(itemId);
  if (eid !== undefined) {
    itemIdToEid.delete(itemId);
    eidToItemId.delete(eid);
  }
};

export const unregisterPlayerMapping = (sessionId: string): void => {
  const eid = sessionIdToEid.get(sessionId);
  if (eid !== undefined) {
    sessionIdToEid.delete(sessionId);
    eidToSessionId.delete(eid);
  }
};

export const getItemEid = (itemId: string): number | undefined => {
  return itemIdToEid.get(itemId);
};

export const getItemId = (eid: number): string | undefined => {
  return eidToItemId.get(eid);
};

export const getPlayerEid = (sessionId: string): number | undefined => {
  return sessionIdToEid.get(sessionId);
};

export const getSessionId = (eid: number): string | undefined => {
  return eidToSessionId.get(eid);
};

export const hashItemId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const syncItemEcsToSchema = (
  world: ServerWorld,
  eid: number,
  itemSchema: ItemSchema
): void => {
  itemSchema.x = Position.x[eid];
  itemSchema.y = Position.y[eid];

  // Calculate cooking progress if timer exists (regardless of held state)
  if (hasComponent(world, eid, CookingTimer)) {
    const elapsed = CookingTimer.elapsed[eid];
    const duration = CookingTimer.duration[eid];
    itemSchema.cookingProgress =
      duration > 0 ? Math.min(elapsed / duration, 1) : 0;
  } else {
    itemSchema.cookingProgress = 0;
  }

  // Determine state from components
  const [heldByEid] = getRelationTargets(world, eid, HeldBy);
  if (heldByEid) {
    itemSchema.heldBy = getSessionId(heldByEid) || "";
    itemSchema.state = "held";
  } else {
    itemSchema.heldBy = "";
    if (hasComponent(world, eid, CookingTimer)) {
      itemSchema.state = "cooking";
    } else {
      itemSchema.state = "on_counter";
    }
  }

  // Determine itemType from components
  if (hasComponent(world, eid, CookedPatty)) {
    itemSchema.itemType = "cooked_patty";
  } else if (hasComponent(world, eid, UncookedPatty)) {
    itemSchema.itemType = "uncooked_patty";
  }
};

export const syncPlayerEcsToSchema = (
  world: ServerWorld,
  eid: number,
  playerSchema: PlayerSchema
): void => {
  playerSchema.x = Position.x[eid];
  playerSchema.y = Position.y[eid];
  playerSchema.facingX = FacingDirection.x[eid];
  playerSchema.facingY = FacingDirection.y[eid];
};

export const syncAllItemsToSchema = (
  world: ServerWorld,
  itemsSchema: Map<string, ItemSchema>
): void => {
  // Update existing items
  for (const [itemId, itemSchema] of itemsSchema) {
    const eid = getItemEid(itemId);
    if (eid !== undefined) {
      syncItemEcsToSchema(world, eid, itemSchema);
    }
  }
};

export const syncAllPlayersToSchema = (
  world: ServerWorld,
  playersSchema: Map<string, PlayerSchema>
): void => {
  // Update existing players
  for (const [sessionId, playerSchema] of playersSchema) {
    const eid = getPlayerEid(sessionId);
    if (eid !== undefined) {
      syncPlayerEcsToSchema(world, eid, playerSchema);
    }
  }
};
