import * as Pixi from "pixi.js";
import {
  keys,
  PLAYER_SIZE,
  PLAYER_SPEED,
  TILE_WIDTH,
  TILE_HEIGHT,
  holdableItems,
} from "./vars";
import { Rapier, world, playerContainer, debugContainer } from "./setup";
import type RAPIER from "@dimforge/rapier2d-compat";
import { entityColliderRegistry, counterColliderRegistry } from "./level";

export const playerSprite = new Pixi.Sprite(Pixi.Assets.get("player"));
playerSprite.width = PLAYER_SIZE;
playerSprite.height = PLAYER_SIZE;
playerSprite.anchor.set(0.5);
playerSprite.x = 0;
playerSprite.y = 0;
playerContainer.addChild(playerSprite);

const playerBodyDesc =
  Rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
    playerSprite.x,
    playerSprite.y
  );
export const playerBody = world.createRigidBody(playerBodyDesc);

const playerColliderDesc = Rapier.ColliderDesc.cuboid(
  PLAYER_SIZE / 2,
  PLAYER_SIZE / 2
);
const playerCollider = world.createCollider(playerColliderDesc, playerBody);

const interactableColliderDesc = Rapier.ColliderDesc.cuboid(
  PLAYER_SIZE / 2,
  PLAYER_SIZE / 2
)
  .setSensor(true)
  .setTranslation(0, 0);
export const interactableCollider = world.createCollider(
  interactableColliderDesc,
  playerBody
);

const characterController = world.createCharacterController(0.01);

characterController.setUp({ x: 0.0, y: 1.0 });

characterController.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
characterController.setMinSlopeSlideAngle((30 * Math.PI) / 180);

export const debugSprite = new Pixi.Sprite(Pixi.Assets.get("debug"));
debugSprite.width = PLAYER_SIZE;
debugSprite.height = PLAYER_SIZE;
debugSprite.anchor.set(0.5);
debugSprite.alpha = 0.25;
debugSprite.x = 0;
debugSprite.y = 0;
debugContainer.addChild(debugSprite);

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

export let lastMoveDirection: { x: number; y: number } | null = null;

export type HeldItem = {
  collider: RAPIER.Collider;
  sprite: Pixi.Sprite;
  rigidBody: RAPIER.RigidBody;
  type: string;
};

export let heldItem: HeldItem | null = null;

export const updatePlayerMovement = (timeStep: number) => {
  let moveX = 0;
  let moveY = 0;

  const moveDistance = PLAYER_SPEED * timeStep;

  if (keys["a"] || keys["arrowleft"]) {
    moveX = -moveDistance;
    lastMoveDirection = { x: -1, y: 0 };
  }
  if (keys["d"] || keys["arrowright"]) {
    moveX = moveDistance;
    lastMoveDirection = { x: 1, y: 0 };
  }
  if (keys["w"] || keys["arrowup"]) {
    moveY = -moveDistance;
    lastMoveDirection = { x: 0, y: -1 };
  }
  if (keys["s"] || keys["arrowdown"]) {
    moveY = moveDistance;
    lastMoveDirection = { x: 0, y: 1 };
  }

  if (moveX !== 0 || moveY !== 0) {
    const desiredTranslation = { x: moveX, y: moveY };
    characterController.computeColliderMovement(
      playerCollider,
      desiredTranslation
    );

    const correctedMovement = characterController.computedMovement();

    const currentPos = playerBody.translation();
    playerBody.setNextKinematicTranslation({
      x: currentPos.x + correctedMovement.x,
      y: currentPos.y + correctedMovement.y,
    });
  }
};

export const updateInteractablePosition = () => {
  const playerPos = playerBody.translation();
  let offsetX = 0;
  let offsetY = 0;

  if (lastMoveDirection) {
    offsetX = lastMoveDirection.x * PLAYER_SIZE;
    offsetY = lastMoveDirection.y * PLAYER_SIZE;
  }

  interactableCollider.setTranslation({
    x: playerPos.x + offsetX,
    y: playerPos.y + offsetY,
  });
};

export const handleInteraction = (): Array<RAPIER.Collider> => {
  const intersectingColliders: Array<RAPIER.Collider> = [];

  const interactablePos = interactableCollider.translation();
  const interactableRot = interactableCollider.rotation();
  const interactableShape = interactableCollider.shape;

  world.intersectionsWithShape(
    interactablePos,
    interactableRot,
    interactableShape,
    (collider: RAPIER.Collider) => {
      intersectingColliders.push(collider);
      return true;
    },
    undefined,
    undefined,
    undefined,
    playerBody
  );

  return intersectingColliders;
};

const dropItemAtPosition = (x: number, y: number): boolean => {
  if (!heldItem) return false;

  heldItem.rigidBody.setTranslation({ x, y }, true);

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_WIDTH / 2,
    TILE_HEIGHT / 2
  );
  const newCollider = world.createCollider(colliderDesc, heldItem.rigidBody);

  entityColliderRegistry.delete(heldItem.collider);
  entityColliderRegistry.set(newCollider, {
    type: heldItem.type,
    sprite: heldItem.sprite,
  });

  heldItem.sprite.x = x + TILE_WIDTH / 2;
  heldItem.sprite.y = y + TILE_HEIGHT / 2;

  heldItem = null;

  return true;
};

export const pickupItem = (collider: RAPIER.Collider): boolean => {
  const entityInfo = entityColliderRegistry.get(collider);
  if (!entityInfo) return false;

  if (
    holdableItems.includes(entityInfo.type as (typeof holdableItems)[number])
  ) {
    if (heldItem) {
      const newItemRigidBody = collider.parent();
      if (!newItemRigidBody) return false;
      const newItemPos = newItemRigidBody.translation();

      dropItemAtPosition(newItemPos.x, newItemPos.y);
    }

    const rigidBody = collider.parent();
    if (!rigidBody) return false;

    world.removeCollider(collider, false);

    heldItem = {
      collider,
      sprite: entityInfo.sprite,
      rigidBody,
      type: entityInfo.type,
    };

    return true;
  }

  return false;
};

export const dropItem = (): boolean => {
  if (!heldItem) return false;

  const interactablePos = interactableCollider.translation();
  const interactableRot = interactableCollider.rotation();
  const interactableShape = interactableCollider.shape;

  const counterColliders: Array<RAPIER.Collider> = [];

  world.intersectionsWithShape(
    interactablePos,
    interactableRot,
    interactableShape,
    (collider: RAPIER.Collider) => {
      if (counterColliderRegistry.has(collider)) {
        counterColliders.push(collider);
      }
      return true;
    },
    undefined,
    undefined,
    undefined,
    playerBody
  );

  if (counterColliders.length > 0) {
    let bestCounter: RAPIER.Collider | null = null;
    let maxOverlapArea = 0;

    const interactableHalfExtents = PLAYER_SIZE / 2;

    for (const counterCollider of counterColliders) {
      const counterPos = counterColliderRegistry.get(counterCollider);
      if (!counterPos) continue;

      const counterCenterX = counterPos.x + TILE_WIDTH / 2;
      const counterCenterY = counterPos.y + TILE_HEIGHT / 2;
      const counterHalfExtentsX = TILE_WIDTH / 2;
      const counterHalfExtentsY = TILE_HEIGHT / 2;

      const left = Math.max(
        interactablePos.x - interactableHalfExtents,
        counterCenterX - counterHalfExtentsX
      );
      const right = Math.min(
        interactablePos.x + interactableHalfExtents,
        counterCenterX + counterHalfExtentsX
      );
      const bottom = Math.max(
        interactablePos.y - interactableHalfExtents,
        counterCenterY - counterHalfExtentsY
      );
      const top = Math.min(
        interactablePos.y + interactableHalfExtents,
        counterCenterY + counterHalfExtentsY
      );

      if (right > left && top > bottom) {
        const overlapArea = (right - left) * (top - bottom);
        if (overlapArea > maxOverlapArea) {
          maxOverlapArea = overlapArea;
          bestCounter = counterCollider;
        }
      }
    }

    if (!bestCounter) return false;

    const counterPos = counterColliderRegistry.get(bestCounter);
    if (!counterPos) return false;

    const tileCenterX = counterPos.x + TILE_WIDTH / 2;
    const tileCenterY = counterPos.y + TILE_HEIGHT / 2;

    return dropItemAtPosition(tileCenterX, tileCenterY);
  }

  return false;
};
