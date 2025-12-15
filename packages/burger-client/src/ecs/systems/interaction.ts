import {
  query,
  hasComponent,
  removeComponent,
  addComponent,
  getRelationTargets,
  Wildcard,
} from "bitecs";
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
  Sprite,
  SittingOn,
  CookingTimer,
  UncookedPatty,
} from "../components";
import type { GameWorld } from "../world";
import { getRapierWorld, getEntityPosition } from "./physics";
import {
  PLAYER_SIZE,
  TILE_WIDTH,
  TILE_HEIGHT,
  MIN_OVERLAP_THRESHOLD,
  COOKING_DURATION,
} from "../../vars";
import { Rapier } from "../../setup";
import {
  removeDebugTimerText,
  getStoveOnCounter,
  isCounterOccupiedByItem,
} from "./cooking";

const debug = debugFactory("burger:ecs:systems:interaction");
const INTERACTION_ZONE_AREA = PLAYER_SIZE * PLAYER_SIZE;
const MIN_OVERLAP_AREA = INTERACTION_ZONE_AREA * MIN_OVERLAP_THRESHOLD;

const startWaitingPattyOnCounter = (
  world: GameWorld,
  counterEid: number
): void => {
  const stoveEid = getStoveOnCounter(world, counterEid);
  if (stoveEid === 0) return;

  for (const eid of query(world, [SittingOn(counterEid), UncookedPatty])) {
    if (hasComponent(world, eid, CookingTimer)) continue;

    addComponent(world, eid, CookingTimer);
    if (!CookingTimer.duration[eid]) {
      CookingTimer.duration[eid] = COOKING_DURATION;
    }
    debug(
      "Started cooking waiting patty %d on counter %d (stove %d)",
      eid,
      counterEid,
      stoveEid
    );
    break;
  }
};

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

const getInteractionPosition = (
  playerEid: number
): { x: number; y: number } => {
  const playerPos = getEntityPosition(playerEid);
  return {
    x: playerPos.x + FacingDirection.x[playerEid] * PLAYER_SIZE,
    y: playerPos.y + FacingDirection.y[playerEid] * PLAYER_SIZE,
  };
};

const calculateOverlapArea = (
  interactionPos: { x: number; y: number },
  entityPos: { x: number; y: number }
): number => {
  const interactableHalfExtents = PLAYER_SIZE / 2;
  const entityHalfExtentsX = TILE_WIDTH / 2;
  const entityHalfExtentsY = TILE_HEIGHT / 2;

  const left = Math.max(
    interactionPos.x - interactableHalfExtents,
    entityPos.x - entityHalfExtentsX
  );
  const right = Math.min(
    interactionPos.x + interactableHalfExtents,
    entityPos.x + entityHalfExtentsX
  );
  const bottom = Math.max(
    interactionPos.y - interactableHalfExtents,
    entityPos.y - entityHalfExtentsY
  );
  const top = Math.min(
    interactionPos.y + interactableHalfExtents,
    entityPos.y + entityHalfExtentsY
  );

  if (right > left && top > bottom) {
    return (right - left) * (top - bottom);
  }
  return 0;
};

const findBestHoldable = (
  world: GameWorld,
  playerEid: number,
  excludeEid: number = 0
): number | null => {
  const entities = findEntitiesAtInteractionZone(world, playerEid);
  const interactionPos = getInteractionPosition(playerEid);

  let bestHoldable: number | null = null;
  let maxOverlapArea = 0;

  for (const eid of entities) {
    if (!hasComponent(world, eid, Holdable)) continue;
    if (eid === excludeEid) continue;

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
  const interactionPos = getInteractionPosition(playerEid);

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

    // Track best overall counter
    if (overlapArea > maxOverlapArea) {
      maxOverlapArea = overlapArea;
      bestCounter = { eid, x: entityPos.x, y: entityPos.y, occupied };
    }

    // Track best unoccupied counter separately
    if (!occupied && overlapArea > maxUnoccupiedOverlapArea) {
      maxUnoccupiedOverlapArea = overlapArea;
      bestUnoccupiedCounter = { eid, x: entityPos.x, y: entityPos.y };
    }
  }

  // If best counter is occupied, check if we should use unoccupied fallback
  if (bestCounter?.occupied && bestUnoccupiedCounter) {
    // Only use unoccupied if its overlap is significant compared to the occupied one
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
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return false;

  const currentlyHeld = getPlayerHeldEntity(world);
  if (currentlyHeld !== null) {
    const oldItemPos = getEntityPosition(itemEid);
    const [swapCounterEid] = getRelationTargets(world, itemEid, SittingOn);
    debug(
      "Swap: dropping held item at (%d, %d), counterEid=%d",
      oldItemPos.x,
      oldItemPos.y,
      swapCounterEid ?? 0
    );
    dropItemAtPosition(
      world,
      playerEid,
      oldItemPos.x,
      oldItemPos.y,
      swapCounterEid ?? 0
    );
  }

  if (hasComponent(world, itemEid, CookingTimer)) {
    removeComponent(world, itemEid, CookingTimer);
    removeDebugTimerText(itemEid);
  }

  const [previousCounterEid] = getRelationTargets(world, itemEid, SittingOn);

  // Remove the SPECIFIC relation, not Wildcard - this properly cleans up
  // SittingOn(Wildcard) too when there are no other targets
  if (previousCounterEid) {
    removeComponent(world, itemEid, SittingOn(previousCounterEid));
    startWaitingPattyOnCounter(world, previousCounterEid);
  }

  const collider = Collider[itemEid];
  if (collider) {
    rapierWorld.removeCollider(collider, false);
  }

  addComponent(world, itemEid, HeldBy(playerEid));

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

  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return false;

  const itemEid = heldEntity;
  const rigidBody = RigidBody[itemEid];

  if (rigidBody) {
    rigidBody.setTranslation({ x, y }, true);

    const colliderDesc = Rapier.ColliderDesc.cuboid(
      TILE_WIDTH / 2,
      TILE_HEIGHT / 2
    );
    const newCollider = rapierWorld.createCollider(colliderDesc, rigidBody);
    Collider[itemEid] = newCollider;
  }

  const sprite = Sprite[itemEid];
  if (sprite) {
    sprite.x = x + TILE_WIDTH / 2;
    sprite.y = y + TILE_HEIGHT / 2;
  }

  removeComponent(world, itemEid, HeldBy(playerEid));
  addComponent(world, itemEid, SittingOn(counterEid));

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

    const heldEntity = getPlayerHeldEntity(world);
    if (heldEntity !== null) {
      debug("Currently holding entity: %d", heldEntity);

      const dropped = dropItem(world, eid);

      if (!dropped) {
        const bestItem = findBestHoldable(world, eid, heldEntity);
        if (bestItem !== null) {
          if (pickupItem(world, eid, bestItem)) {
            debug("Swapped with entity: %d", bestItem);
          }
        }
      }
    } else {
      const bestItem = findBestHoldable(world, eid);
      if (bestItem !== null) {
        if (pickupItem(world, eid, bestItem)) {
          debug("Picked up entity: %d", bestItem);
        }
      }
    }
  }
};
