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
import { PLAYER_SIZE, TILE_WIDTH, TILE_HEIGHT } from "../../vars";
import { Rapier } from "../../setup";
import {
  removeDebugTimerText,
  getStoveOnCounter,
  isCounterOccupiedByItem,
  COOKING_DURATION,
} from "./cooking";

const debug = debugFactory("burger:ecs:systems:interaction");

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

const findBestCounter = (
  world: GameWorld,
  playerEid: number
): { eid: number; x: number; y: number } | null => {
  const entities = findEntitiesAtInteractionZone(world, playerEid);

  const playerPos = getEntityPosition(playerEid);

  const interactionPos = {
    x: playerPos.x + FacingDirection.x[playerEid] * PLAYER_SIZE,
    y: playerPos.y + FacingDirection.y[playerEid] * PLAYER_SIZE,
  };

  let bestCounter: { eid: number; x: number; y: number } | null = null;
  let maxOverlapArea = 0;
  const interactableHalfExtents = PLAYER_SIZE / 2;

  for (const eid of entities) {
    if (!hasComponent(world, eid, Counter)) continue;

    const counterPos = getEntityPosition(eid);
    const counterCenterX = counterPos.x;
    const counterCenterY = counterPos.y;

    if (isCounterOccupiedByItem(world, eid)) continue;

    const counterHalfExtentsX = TILE_WIDTH / 2;
    const counterHalfExtentsY = TILE_HEIGHT / 2;

    const left = Math.max(
      interactionPos.x - interactableHalfExtents,
      counterCenterX - counterHalfExtentsX
    );
    const right = Math.min(
      interactionPos.x + interactableHalfExtents,
      counterCenterX + counterHalfExtentsX
    );
    const bottom = Math.max(
      interactionPos.y - interactableHalfExtents,
      counterCenterY - counterHalfExtentsY
    );
    const top = Math.min(
      interactionPos.y + interactableHalfExtents,
      counterCenterY + counterHalfExtentsY
    );

    if (right > left && top > bottom) {
      const overlapArea = (right - left) * (top - bottom);
      if (overlapArea > maxOverlapArea) {
        maxOverlapArea = overlapArea;
        bestCounter = { eid, x: counterCenterX, y: counterCenterY };
      }
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

    const entities = findEntitiesAtInteractionZone(world, eid);

    const heldEntity = getPlayerHeldEntity(world);
    if (heldEntity !== null) {
      debug("Currently holding entity: %d", heldEntity);

      const dropped = dropItem(world, eid);

      if (!dropped) {
        for (const entityEid of entities) {
          if (
            hasComponent(world, entityEid, Holdable) &&
            entityEid !== heldEntity
          ) {
            if (pickupItem(world, eid, entityEid)) {
              debug("Swapped with entity: %d", entityEid);
              break;
            }
          }
        }
      }
    } else {
      for (const entityEid of entities) {
        if (hasComponent(world, entityEid, Holdable)) {
          if (pickupItem(world, eid, entityEid)) {
            debug("Picked up entity: %d", entityEid);
            break;
          }
        }
      }
    }
  }
};
