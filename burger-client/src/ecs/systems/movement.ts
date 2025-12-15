import { query } from "bitecs";
import {
  Player,
  Input,
  Position,
  RigidBody,
  Collider,
  CharacterController,
  FacingDirection,
} from "../components";
import type { GameWorld } from "../world";
import { PLAYER_SPEED } from "../../vars";

export const playerMovementSystem = (
  world: GameWorld,
  timeStep: number
): void => {
  for (const eid of query(world, [
    Player,
    Input,
    Position,
    RigidBody,
    Collider,
    CharacterController,
  ])) {
    const controller = CharacterController[eid];
    const rigidBody = RigidBody[eid];
    const collider = Collider[eid];

    if (!controller || !rigidBody || !collider) continue;

    let moveX = 0;
    let moveY = 0;
    const moveDistance = PLAYER_SPEED * timeStep;

    if (Input.left[eid]) {
      moveX = -moveDistance;
      FacingDirection.x[eid] = -1;
      FacingDirection.y[eid] = 0;
    }
    if (Input.right[eid]) {
      moveX = moveDistance;
      FacingDirection.x[eid] = 1;
      FacingDirection.y[eid] = 0;
    }
    if (Input.up[eid]) {
      moveY = -moveDistance;
      FacingDirection.x[eid] = 0;
      FacingDirection.y[eid] = -1;
    }
    if (Input.down[eid]) {
      moveY = moveDistance;
      FacingDirection.x[eid] = 0;
      FacingDirection.y[eid] = 1;
    }

    if (moveX !== 0 || moveY !== 0) {
      const desiredTranslation = { x: moveX, y: moveY };
      controller.computeColliderMovement(collider, desiredTranslation);

      const correctedMovement = controller.computedMovement();
      const currentPos = rigidBody.translation();

      rigidBody.setNextKinematicTranslation({
        x: currentPos.x + correctedMovement.x,
        y: currentPos.y + correctedMovement.y,
      });
    }
  }
};
