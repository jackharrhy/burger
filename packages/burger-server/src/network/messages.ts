import debugFactory from "debug";
import {
  addComponent,
  removeComponent,
  getRelationTargets,
  query,
} from "bitecs";
import {
  Position,
  FacingDirection,
  HeldBy,
  SittingOn,
  PLAYER_SIZE,
} from "@burger-king/shared";
import type { ServerWorld } from "../ecs/world";
import { findBestHoldable, findBestCounter } from "../ecs/interaction";
import { findCounterAtPosition } from "../ecs/level";
import { getItemId, getNetworkId } from "../ecs/sync";

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

  if (isHolding) {
    debug("Player %s is holding item, trying to drop/swap", sessionId);
    const counter = findBestCounter(world, playerX, playerY, facingX, facingY);
    if (!counter) {
      debug("No counter found for drop");
      return;
    }

    debug(
      "Found counter %d at (%.1f, %.1f), occupied=%s",
      counter.eid,
      counter.x,
      counter.y,
      counter.occupied
    );

    if (counter.occupied) {
      handleSwap(world, sessionId, playerEid, heldItems[0], counter);
    } else {
      handleDrop(world, sessionId, playerEid, heldItems[0], counter);
    }
  } else {
    debug("Player %s is not holding, trying to pickup", sessionId);
    const item = findBestHoldable(world, playerX, playerY, facingX, facingY);
    if (!item) {
      debug("No holdable item found");
      return;
    }

    handlePickup(world, sessionId, playerEid, item.eid, item.itemId);
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
  counter: { eid: number; x: number; y: number }
): void => {
  const itemId = getItemId(itemEid);
  if (!itemId) return;

  performDrop(world, itemEid, counter.eid, counter.x, counter.y);
  debug(
    "Drop: player=%s item=%s at (%.1f, %.1f) counter=%d",
    sessionId,
    itemId,
    counter.x,
    counter.y,
    counter.eid
  );
};

const handleSwap = (
  world: ServerWorld,
  sessionId: string,
  playerEid: number,
  heldItemEid: number,
  counter: { eid: number; x: number; y: number; occupied: boolean }
): void => {
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
  performDrop(world, heldItemEid, counter.eid, counter.x, counter.y);

  debug(
    "Swap: player=%s dropped=%s picked=%s at counter=%d",
    sessionId,
    heldItemId,
    itemToPickup.itemId,
    counter.eid
  );
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
