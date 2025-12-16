import { query } from "bitecs";
import { Position, RigidBody, Networked } from "../components";
import type { GameWorld } from "../world";
import { getLocalPlayerEid } from "../../network/client";

export const networkPositionSyncSystem = (world: GameWorld): void => {
  const localPlayerEid = getLocalPlayerEid();

  for (const eid of query(world, [Networked, Position, RigidBody])) {
    if (eid === localPlayerEid) continue;

    const rigidBody = RigidBody[eid];
    if (rigidBody) {
      rigidBody.setTranslation(
        { x: Position.x[eid], y: Position.y[eid] },
        true
      );
    }
  }
};
