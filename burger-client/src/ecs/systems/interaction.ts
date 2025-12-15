import { query, hasComponent } from "bitecs";
import debugFactory from "debug";
import {
  Player,
  Input,
  Position,
  FacingDirection,
  Holdable,
  HeldBy,
  Counter,
  Collider,
  RigidBody,
  Sprite,
} from "../components";
import type { GameWorld } from "../world";
import { getRapierWorld } from "./physics";
import { PLAYER_SIZE, TILE_WIDTH, TILE_HEIGHT } from "../../vars";
import { Rapier } from "../../setup";

const debug = debugFactory("burger:ecs:systems:interaction");

let playerHeldEntity: number | null = null;

export const getPlayerHeldEntity = (): number | null => playerHeldEntity;

const findEntitiesAtInteractionZone = (
  world: GameWorld,
  playerEid: number
): number[] => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) {
    throw new Error("Rapier world not initialized");
  }

  const playerPos = {
    x: Position.x[playerEid],
    y: Position.y[playerEid],
  };

  const interactionPos = {
    x: playerPos.x + FacingDirection.x[playerEid] * PLAYER_SIZE,
    y: playerPos.y + FacingDirection.y[playerEid] * PLAYER_SIZE,
  };

  debug("Interaction pos: %o", interactionPos);

  const foundEntities: number[] = [];
  const shape = new Rapier.Cuboid(PLAYER_SIZE / 2, PLAYER_SIZE / 2);

  let colliderCount = 0;
  rapierWorld.intersectionsWithShape(
    interactionPos,
    0,
    shape,
    (collider) => {
      colliderCount++;
      debug("Found collider in physics world");
      for (const eid of query(world, [Collider])) {
        if (Collider[eid] === collider) {
          debug("Matched to entity: %d", eid);
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

const isCounterOccupied = (
  world: GameWorld,
  counterX: number,
  counterY: number
): boolean => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return false;

  const shape = new Rapier.Cuboid(TILE_WIDTH / 4, TILE_HEIGHT / 4);
  let occupied = false;

  rapierWorld.intersectionsWithShape(
    { x: counterX, y: counterY },
    0,
    shape,
    (collider) => {
      for (const eid of query(world, [Collider])) {
        if (Collider[eid] === collider) {
          if (hasComponent(world, eid, Holdable) && eid !== playerHeldEntity) {
            occupied = true;
            return false;
          }
          break;
        }
      }
      return true;
    }
  );

  return occupied;
};

const findBestCounter = (
  world: GameWorld,
  playerEid: number
): { eid: number; x: number; y: number } | null => {
  const entities = findEntitiesAtInteractionZone(world, playerEid);

  const playerPos = {
    x: Position.x[playerEid],
    y: Position.y[playerEid],
  };

  const interactionPos = {
    x: playerPos.x + FacingDirection.x[playerEid] * PLAYER_SIZE,
    y: playerPos.y + FacingDirection.y[playerEid] * PLAYER_SIZE,
  };

  let bestCounter: { eid: number; x: number; y: number } | null = null;
  let maxOverlapArea = 0;
  const interactableHalfExtents = PLAYER_SIZE / 2;

  for (const eid of entities) {
    if (!hasComponent(world, eid, Counter)) continue;

    const counterCenterX = Position.x[eid];
    const counterCenterY = Position.y[eid];

    if (isCounterOccupied(world, counterCenterX, counterCenterY)) continue;

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

  if (playerHeldEntity !== null) {
    const oldItemPos = {
      x: Position.x[itemEid],
      y: Position.y[itemEid],
    };
    dropItemAtPosition(world, playerEid, oldItemPos.x, oldItemPos.y);
  }

  const collider = Collider[itemEid];
  if (collider) {
    rapierWorld.removeCollider(collider, false);
  }

  HeldBy.holder[itemEid] = playerEid;
  playerHeldEntity = itemEid;

  return true;
};

const dropItemAtPosition = (
  _world: GameWorld,
  _playerEid: number,
  x: number,
  y: number
): boolean => {
  if (playerHeldEntity === null) return false;

  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return false;

  const itemEid = playerHeldEntity;
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

  Position.x[itemEid] = x;
  Position.y[itemEid] = y;

  const sprite = Sprite[itemEid];
  if (sprite) {
    sprite.x = x + TILE_WIDTH / 2;
    sprite.y = y + TILE_HEIGHT / 2;
  }

  HeldBy.holder[itemEid] = 0;
  playerHeldEntity = null;

  return true;
};

const dropItem = (world: GameWorld, playerEid: number): boolean => {
  if (playerHeldEntity === null) return false;

  const counter = findBestCounter(world, playerEid);
  if (!counter) return false;

  const success = dropItemAtPosition(world, playerEid, counter.x, counter.y);

  return success;
};

export const interactionSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Player, Input, FacingDirection])) {
    if (!Input.interactPressed[eid]) continue;

    debug("Interact pressed!");

    const entities = findEntitiesAtInteractionZone(world, eid);
    debug("Found entities at interaction zone: %o", entities);

    for (const entityEid of entities) {
      debug(
        "Entity %d - Holdable: %s, Counter: %s",
        entityEid,
        hasComponent(world, entityEid, Holdable),
        hasComponent(world, entityEid, Counter)
      );
    }

    if (playerHeldEntity !== null) {
      debug("Currently holding entity: %d", playerHeldEntity);

      debug("Trying to drop...");
      const dropped = dropItem(world, eid);
      debug("Drop result: %s", dropped);

      if (!dropped) {
        for (const entityEid of entities) {
          if (
            hasComponent(world, entityEid, Holdable) &&
            entityEid !== playerHeldEntity
          ) {
            debug("Trying to swap with entity: %d", entityEid);
            if (pickupItem(world, eid, entityEid)) {
              debug("Swap successful!");
              break;
            }
          }
        }
      }
    } else {
      debug("Not holding anything, trying to pick up...");
      for (const entityEid of entities) {
        if (hasComponent(world, entityEid, Holdable)) {
          debug("Trying to pick up entity: %d", entityEid);
          if (pickupItem(world, eid, entityEid)) {
            debug("Pickup successful!");
            break;
          }
        }
      }
    }
  }
};
