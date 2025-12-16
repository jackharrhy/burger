import { query } from "bitecs";
import { Position, FacingDirection, HeldBy, RigidBody } from "../components";
import { PLAYER_SIZE } from "@burger-king/shared";
import type { GameWorld } from "../world";
import { getLocalPlayerEid } from "../../network/client";
import { getEntityPosition } from "./physics";

export const heldItemSyncSystem = (world: GameWorld): void => {
  const localPlayerEid = getLocalPlayerEid();
  if (!localPlayerEid) return;

  const playerPos = getEntityPosition(localPlayerEid);
  const facingX = FacingDirection.x[localPlayerEid];
  const facingY = FacingDirection.y[localPlayerEid];

  const heldItems = query(world, [RigidBody, HeldBy(localPlayerEid)]);

  for (const itemEid of heldItems) {
    Position.x[itemEid] = playerPos.x + facingX * PLAYER_SIZE;
    Position.y[itemEid] = playerPos.y + facingY * PLAYER_SIZE;

    const rigidBody = RigidBody[itemEid];
    if (rigidBody) {
      rigidBody.setTranslation(
        { x: Position.x[itemEid], y: Position.y[itemEid] },
        true
      );
    }
  }
};
