import debugFactory from "debug";
import {
  addEntity,
  addComponent,
  removeComponent,
  removeEntity,
  getRelationTargets,
  query,
  hasComponent,
} from "bitecs";
import {
  Position,
  FacingDirection,
  HeldBy,
  SittingOn,
  PLAYER_SIZE,
  CookedPatty,
  ItemStock,
  SpawnType,
  Order,
  UncookedPatty,
  Holdable,
  NetworkId,
  Networked,
} from "@burger-king/shared";
import type { ServerWorld } from "../ecs/world";
import {
  findBestHoldable,
  findBestSurface,
  type BestSurfaceResult,
} from "../ecs/interaction";
import { findCounterAtPosition } from "../ecs/level";
import { getItemId, getNetworkId, registerItemMapping } from "../ecs/sync";

const debug = debugFactory("burger:server:messages");

export type MoveMessage = {
  type: "move";
  x: number;
  y: number;
  facingX: number;
  facingY: number;
};

export type InteractMessage = {
  type: "interact";
};

export type ClientMessage = MoveMessage | InteractMessage;

export type ClientInfo = {
  sessionId: string;
  playerEid: number;
  networkId: string;
};

export const handleMessage = (
  world: ServerWorld,
  client: ClientInfo,
  message: ClientMessage,
  itemEids: Map<string, number>
): void => {
  switch (message.type) {
    case "move":
      handleMove(world, client, message);
      break;
    case "interact":
      handleInteract(world, client, itemEids);
      break;
  }
};

const handleMove = (
  world: ServerWorld,
  client: ClientInfo,
  message: MoveMessage
): void => {
  const { playerEid } = client;

  Position.x[playerEid] = message.x;
  Position.y[playerEid] = message.y;
  FacingDirection.x[playerEid] = message.facingX;
  FacingDirection.y[playerEid] = message.facingY;

  const heldItems = query(world, [HeldBy(playerEid)]);
  for (const itemEid of heldItems) {
    Position.x[itemEid] = message.x + message.facingX * PLAYER_SIZE;
    Position.y[itemEid] = message.y + message.facingY * PLAYER_SIZE;
  }
};

const handleInteract = (
  world: ServerWorld,
  client: ClientInfo,
  itemEids: Map<string, number>
): void => {
  const { sessionId, playerEid } = client;

  const playerX = Position.x[playerEid];
  const playerY = Position.y[playerEid];
  const facingX = FacingDirection.x[playerEid];
  const facingY = FacingDirection.y[playerEid];

  debug(
    "Interact from %s at (%.1f, %.1f) facing (%.1f, %.1f)",
    sessionId,
    playerX,
    playerY,
    facingX,
    facingY
  );

  const heldItems = query(world, [HeldBy(playerEid)]);
  const isHolding = heldItems.length > 0;

  // Find the best surface in interaction range
  const surface = findBestSurface(world, playerX, playerY, facingX, facingY);

  if (isHolding) {
    const heldItem = heldItems[0];
    debug("Player %s is holding item %d", sessionId, heldItem);

    if (!surface) {
      debug("No surface found for drop");
      return;
    }

    debug(
      "Found surface %d at (%.1f, %.1f), occupied=%s, acceptsItems=%s, destroysItems=%s, acceptsOrders=%s",
      surface.eid,
      surface.x,
      surface.y,
      surface.occupied,
      surface.acceptsItems,
      surface.destroysItems,
      surface.acceptsOrders
    );

    // Priority: Orders > Destroy > Accept
    if (surface.acceptsOrders) {
      handleOrderSubmit(world, sessionId, playerEid, heldItem, surface);
    } else if (surface.destroysItems) {
      handleDestroy(world, sessionId, playerEid, heldItem);
    } else if (surface.acceptsItems) {
      if (surface.occupied) {
        handleSwap(world, sessionId, playerEid, heldItem, surface);
      } else {
        handleDrop(world, sessionId, playerEid, heldItem, surface);
      }
    }
  } else {
    debug("Player %s is not holding, trying to pickup or spawn", sessionId);

    // First try to find a holdable item
    const item = findBestHoldable(world, playerX, playerY, facingX, facingY);
    if (item) {
      handlePickup(world, sessionId, playerEid, item.eid, item.itemId);
      return;
    }

    // No item to pickup - check if surface can spawn items
    if (surface?.spawnsItems) {
      handleSpawn(world, sessionId, playerEid, surface, itemEids);
    } else {
      debug("No holdable item found and no spawner available");
    }
  }
};

const handlePickup = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  itemEid: number,
  itemId: string
): void => {
  performPickup(world, playerEid, itemEid);
  debug("Pickup: player=%s item=%s eid=%d", sessionId, itemId, itemEid);
};

const handleDrop = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  itemEid: number,
  surface: BestSurfaceResult
): void => {
  if (!surface) return;

  const itemId = getItemId(itemEid);
  if (!itemId) return;

  performDrop(world, itemEid, surface.eid, surface.x, surface.y);
  debug(
    "Drop: player=%s item=%s at (%.1f, %.1f) surface=%d",
    sessionId,
    itemId,
    surface.x,
    surface.y,
    surface.eid
  );
};

const handleSwap = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  heldItemEid: number,
  surface: BestSurfaceResult
): void => {
  if (!surface) return;

  const itemToPickup = findBestHoldable(
    world,
    Position.x[playerEid],
    Position.y[playerEid],
    FacingDirection.x[playerEid],
    FacingDirection.y[playerEid],
    heldItemEid
  );
  if (!itemToPickup) return;

  const heldItemId = getItemId(heldItemEid);
  if (!heldItemId) return;

  performPickup(world, playerEid, itemToPickup.eid);
  performDrop(world, heldItemEid, surface.eid, surface.x, surface.y);

  debug(
    "Swap: player=%s dropped=%s picked=%s at surface=%d",
    sessionId,
    heldItemId,
    itemToPickup.itemId,
    surface.eid
  );
};

const handleDestroy = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  itemEid: number
): void => {
  const itemId = getItemId(itemEid);
  if (!itemId) return;

  // Remove the HeldBy relation
  const [heldByPlayerEid] = getRelationTargets(world, itemEid, HeldBy);
  if (heldByPlayerEid) {
    removeComponent(world, itemEid, HeldBy(heldByPlayerEid));
  }

  // Remove the entity entirely
  removeEntity(world, itemEid);

  debug("Destroy: player=%s item=%s eid=%d", sessionId, itemId, itemEid);
};

const handleSpawn = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  surface: BestSurfaceResult,
  itemEids: Map<string, number>
): void => {
  if (!surface) return;

  // Check if there's stock available
  const stock = ItemStock.count[surface.eid];
  if (stock <= 0) {
    debug("Spawn failed: no stock at surface %d", surface.eid);
    return;
  }

  // Get the item type to spawn
  const spawnType = SpawnType.itemType[surface.eid] || "uncooked-patty";

  // Decrement stock
  ItemStock.count[surface.eid] = stock - 1;

  // Create the new item entity
  const itemId = `spawned-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const eid = createSpawnedItem(world, itemId, spawnType, playerEid);

  // Register in itemEids map
  itemEids.set(itemId, eid);

  debug(
    "Spawn: player=%s type=%s eid=%d stock=%d",
    sessionId,
    spawnType,
    eid,
    ItemStock.count[surface.eid]
  );
};

const createSpawnedItem = (
  world: ServerWorld,
  itemId: string,
  itemType: string,
  playerEid: number
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  addComponent(world, eid, Holdable);
  addComponent(world, eid, NetworkId);
  addComponent(world, eid, Networked);

  // Set position to player's position
  const facingX = FacingDirection.x[playerEid];
  const facingY = FacingDirection.y[playerEid];
  Position.x[eid] = Position.x[playerEid] + facingX * PLAYER_SIZE;
  Position.y[eid] = Position.y[playerEid] + facingY * PLAYER_SIZE;
  NetworkId.id[eid] = itemId;

  // Add type-specific component
  if (itemType === "cooked-patty") {
    addComponent(world, eid, CookedPatty);
  } else {
    addComponent(world, eid, UncookedPatty);
  }

  // Add HeldBy relation - player is now holding this item
  addComponent(world, eid, HeldBy(playerEid));

  registerItemMapping(itemId, eid);

  return eid;
};

const handleOrderSubmit = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  pattyEid: number,
  surface: BestSurfaceResult
): void => {
  if (!surface) return;

  // Only cooked patties can fulfill orders
  if (!hasComponent(world, pattyEid, CookedPatty)) {
    debug("Order submit failed: item %d is not a cooked patty", pattyEid);
    return;
  }

  // Find active order at this window
  const orders = query(world, [Order, SittingOn(surface.eid)]);
  if (orders.length === 0) {
    debug("Order submit failed: no active order at surface %d", surface.eid);
    return;
  }

  const orderEid = orders[0];
  Order.fulfilledCount[orderEid]++;

  const itemId = getItemId(pattyEid);

  // Remove the HeldBy relation
  const [heldByPlayerEid] = getRelationTargets(world, pattyEid, HeldBy);
  if (heldByPlayerEid) {
    removeComponent(world, pattyEid, HeldBy(heldByPlayerEid));
  }

  // Destroy the patty
  removeEntity(world, pattyEid);

  debug(
    "Order submit: player=%s item=%s order=%d fulfilled=%d/%d",
    sessionId,
    itemId,
    orderEid,
    Order.fulfilledCount[orderEid],
    Order.requiredCount[orderEid]
  );

  // Check if order complete
  if (Order.fulfilledCount[orderEid] >= Order.requiredCount[orderEid]) {
    debug("Order complete: order=%d", orderEid);
    removeEntity(world, orderEid);
    // TODO: Award points
  }
};

const performPickup = (
  world: ServerWorld,
  playerEid: number,
  itemEid: number
): void => {
  const [counterEid] = getRelationTargets(world, itemEid, SittingOn);
  if (counterEid) {
    removeComponent(world, itemEid, SittingOn(counterEid));
  }

  addComponent(world, itemEid, HeldBy(playerEid));
};

const performDrop = (
  world: ServerWorld,
  itemEid: number,
  counterEid: number,
  x: number,
  y: number
): void => {
  const [heldByPlayerEid] = getRelationTargets(world, itemEid, HeldBy);
  if (heldByPlayerEid) {
    removeComponent(world, itemEid, HeldBy(heldByPlayerEid));
  }

  Position.x[itemEid] = x;
  Position.y[itemEid] = y;

  addComponent(world, itemEid, SittingOn(counterEid));
};

export const handlePlayerDisconnect = (
  world: ServerWorld,
  playerEid: number,
  itemEids: Map<string, number>
): void => {
  for (const [_itemId, itemEid] of itemEids) {
    const [heldByEid] = getRelationTargets(world, itemEid, HeldBy);
    if (heldByEid === playerEid) {
      const playerX = Position.x[playerEid];
      const playerY = Position.y[playerEid];

      const counterEid = findCounterAtPosition(world, playerX, playerY);

      if (counterEid) {
        performDrop(world, itemEid, counterEid, playerX, playerY);
      } else {
        removeComponent(world, itemEid, HeldBy(playerEid));
        Position.x[itemEid] = playerX;
        Position.y[itemEid] = playerY;
      }
    }
  }
};
