import { query, getRelationTargets, Wildcard } from "bitecs";
import { FacingDirection, HeldBy, Sprite, RigidBody } from "../components";
import type { GameWorld } from "../world";
import { PLAYER_SIZE, TILE_WIDTH, TILE_HEIGHT } from "../../vars";

export const heldItemSystem = (world: GameWorld): void => {
  for (const heldEid of query(world, [HeldBy(Wildcard)])) {
    const [holderEid] = getRelationTargets(world, heldEid, HeldBy);
    if (!holderEid) continue;

    const holderBody = RigidBody[holderEid];
    if (!holderBody) continue;

    const holderPos = holderBody.translation();

    const interactionPos = {
      x: holderPos.x + FacingDirection.x[holderEid] * PLAYER_SIZE,
      y: holderPos.y + FacingDirection.y[holderEid] * PLAYER_SIZE,
    };

    const rigidBody = RigidBody[heldEid];
    if (rigidBody) {
      rigidBody.setTranslation(interactionPos, true);
    }

    const sprite = Sprite[heldEid];
    if (sprite) {
      sprite.x = interactionPos.x + TILE_WIDTH / 2;
      sprite.y = interactionPos.y + TILE_HEIGHT / 2;
    }
  }
};
