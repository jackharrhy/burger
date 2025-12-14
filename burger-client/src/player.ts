import * as Pixi from "pixi.js";
import { keys, PLAYER_SIZE, PLAYER_SPEED } from "./vars";
import { Rapier, world, playerContainer, debugContainer } from "./setup";

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
