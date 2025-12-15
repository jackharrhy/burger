import { query, hasComponent, Wildcard } from "bitecs";
import debugFactory from "debug";
import {
  Player,
  Input,
  FacingDirection,
  Holdable,
  HeldBy,
  Counter,
  Collider,
  RigidBody,
} from "../components";
import type { GameWorld } from "../world";
import { getRapierWorld, getEntityPosition } from "./physics";
import { PLAYER_SIZE } from "../../vars";
import {
  getInteractionPosition,
  calculateOverlapArea,
  MIN_OVERLAP_AREA,
} from "@burger-king/shared";
import { Rapier } from "../../setup";
import { isCounterOccupiedByItem } from "./cooking";
import {
  getRoom,
  applyOptimisticPickup,
  applyOptimisticDrop,
  getServerItemForEntity,
} from "../../network";
import { findCounterAtPosition } from "../../entities/items";

const debug = debugFactory("burger:ecs:systems:interaction");

export const getPlayerHeldEntity = (world: GameWorld): number | null => {
  const held = query(world, [HeldBy(Wildcard)]);
  return held.length > 0 ? held[0] : null;
};

const findEntitiesAtInteractionZone = (
  world: GameWorld,
  playerEid: number
): number[] => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) {
    throw new Error("Rapier world not initialized");
  }

  const playerPos = getEntityPosition(playerEid);

  const interactionPos = {
    x: playerPos.x + FacingDirection.x[playerEid] * PLAYER_SIZE,
    y: playerPos.y + FacingDirection.y[playerEid] * PLAYER_SIZE,
  };

  const foundEntities: number[] = [];
  const shape = new Rapier.Cuboid(PLAYER_SIZE / 2, PLAYER_SIZE / 2);

  let colliderCount = 0;
  rapierWorld.intersectionsWithShape(
    interactionPos,
    0,
    shape,
    (collider) => {
      colliderCount++;
      for (const eid of query(world, [Collider])) {
        if (Collider[eid] === collider) {
          foundEntities.push(eid);
          break;
        }
      }
      return true;
    },
    undefined,
    undefined,
    undefined,
    RigidBody[playerEid] ?? undefined
  );

  debug(
    "Total colliders: %d, matched entities: %d",
    colliderCount,
    foundEntities.length
  );

  return foundEntities;
};

const getClientInteractionPosition = (
  playerEid: number
): { x: number; y: number } => {
  const playerPos = getEntityPosition(playerEid);
  return getInteractionPosition(
    playerPos.x,
    playerPos.y,
    FacingDirection.x[playerEid],
    FacingDirection.y[playerEid]
  );
};

const findBestHoldable = (
  world: GameWorld,
  playerEid: number,
  excludeEid: number = 0
): number | null => {
  const entities = findEntitiesAtInteractionZone(world, playerEid);
  const interactionPos = getClientInteractionPosition(playerEid);

  let bestHoldable: number | null = null;
  let maxOverlapArea = 0;

  for (const eid of entities) {
    if (!hasComponent(world, eid, Holdable)) continue;
    if (eid === excludeEid) continue;

    const room = getRoom();
    if (room) {
      const itemId = getServerItemForEntity(eid);
      if (itemId) {
        const item = room.state.items.get(itemId);
        if (item && item.heldBy !== "") continue;
      }
    }

    const overlapArea = calculateOverlapArea(
      interactionPos,
      getEntityPosition(eid)
    );
    if (overlapArea < MIN_OVERLAP_AREA) continue;

    if (overlapArea > maxOverlapArea) {
      maxOverlapArea = overlapArea;
      bestHoldable = eid;
    }
  }

  return bestHoldable;
};

const findBestCounter = (
  world: GameWorld,
  playerEid: number
): { eid: number; x: number; y: number; occupied: boolean } | null => {
  const entities = findEntitiesAtInteractionZone(world, playerEid);
  const interactionPos = getClientInteractionPosition(playerEid);

  let bestCounter: {
    eid: number;
    x: number;
    y: number;
    occupied: boolean;
  } | null = null;
  let bestUnoccupiedCounter: { eid: number; x: number; y: number } | null =
    null;
  let maxOverlapArea = 0;
  let maxUnoccupiedOverlapArea = 0;

  for (const eid of entities) {
    if (!hasComponent(world, eid, Counter)) continue;

    const entityPos = getEntityPosition(eid);
    const overlapArea = calculateOverlapArea(interactionPos, entityPos);
    if (overlapArea < MIN_OVERLAP_AREA) continue;

    const occupied = isCounterOccupiedByItem(world, eid);

    if (overlapArea > maxOverlapArea) {
      maxOverlapArea = overlapArea;
      bestCounter = { eid, x: entityPos.x, y: entityPos.y, occupied };
    }

    if (!occupied && overlapArea > maxUnoccupiedOverlapArea) {
      maxUnoccupiedOverlapArea = overlapArea;
      bestUnoccupiedCounter = { eid, x: entityPos.x, y: entityPos.y };
    }
  }

  if (bestCounter?.occupied && bestUnoccupiedCounter) {
    const overlapRatio = maxUnoccupiedOverlapArea / maxOverlapArea;
    if (overlapRatio > 0.6) {
      return { ...bestUnoccupiedCounter, occupied: false };
    }
  }

  return bestCounter;
};

const pickupItem = (
  world: GameWorld,
  playerEid: number,
  itemEid: number
): boolean => {
  const room = getRoom();
  if (!room) {
    debug("No room connection, cannot pickup");
    return false;
  }

  const itemId = getServerItemForEntity(itemEid);
  if (!itemId) {
    debug("Item %d has no server ID", itemEid);
    return false;
  }

  const currentlyHeld = getPlayerHeldEntity(world);
  if (currentlyHeld !== null) {
    const oldItemPos = getEntityPosition(itemEid);
    const counterEid = findCounterAtPosition(world, oldItemPos.x, oldItemPos.y);
    dropItemAtPosition(
      world,
      playerEid,
      oldItemPos.x,
      oldItemPos.y,
      counterEid
    );
  }

  const actionId = applyOptimisticPickup(room, itemEid, playerEid);
  if (!actionId) {
    debug("Failed to apply optimistic pickup");
    return false;
  }

  debug(
    "Applied optimistic pickup for item %d (action: %s)",
    itemEid,
    actionId
  );
  return true;
};

const dropItemAtPosition = (
  world: GameWorld,
  playerEid: number,
  x: number,
  y: number,
  counterEid: number
): boolean => {
  const heldEntity = getPlayerHeldEntity(world);
  if (heldEntity === null) return false;

  const room = getRoom();
  if (!room) {
    debug("No room connection, cannot drop");
    return false;
  }

  const actionId = applyOptimisticDrop(
    room,
    heldEntity,
    playerEid,
    x,
    y,
    counterEid
  );
  if (!actionId) {
    debug("Failed to apply optimistic drop");
    return false;
  }

  debug("Applied optimistic drop for item %d at (%d, %d)", heldEntity, x, y);
  return true;
};

const dropItem = (world: GameWorld, playerEid: number): boolean => {
  if (getPlayerHeldEntity(world) === null) return false;

  const counter = findBestCounter(world, playerEid);
  if (!counter) return false;

  if (counter.occupied) {
    debug(
      "dropItem: best counter %d is occupied, triggering swap",
      counter.eid
    );
    return false;
  }

  const success = dropItemAtPosition(
    world,
    playerEid,
    counter.x,
    counter.y,
    counter.eid
  );

  debug("dropItem: counter.eid=%d success=%s", counter.eid, success);

  return success;
};

export const interactionSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Player, Input, FacingDirection])) {
    if (!Input.interactPressed[eid]) continue;

    debug("Interact pressed!");

    const room = getRoom();
    let interactionPerformed = false;

    const heldEntity = getPlayerHeldEntity(world);
    if (heldEntity !== null) {
      debug("Currently holding entity: %d", heldEntity);

      const dropped = dropItem(world, eid);

      if (!dropped) {
        const bestItem = findBestHoldable(world, eid, heldEntity);
        if (bestItem !== null) {
          if (pickupItem(world, eid, bestItem)) {
            debug("Swapped with entity: %d", bestItem);
            interactionPerformed = true;
          }
        }
      } else {
        interactionPerformed = true;
      }
    } else {
      const bestItem = findBestHoldable(world, eid);
      if (bestItem !== null) {
        if (pickupItem(world, eid, bestItem)) {
          debug("Picked up entity: %d", bestItem);
          interactionPerformed = true;
        }
      }
    }

    if (interactionPerformed && room) {
      room.send("interact", { action: "interact" });
      debug("Sent interact message to server");
    }
  }
};
