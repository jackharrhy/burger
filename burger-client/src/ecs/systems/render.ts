import { query } from "bitecs";
import { Sprite, RigidBody } from "../components";
import type { GameWorld } from "../world";

export const renderSyncSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Sprite, RigidBody])) {
    const rigidBody = RigidBody[eid];
    const sprite = Sprite[eid];

    if (!rigidBody || !sprite) continue;

    const pos = rigidBody.translation();
    sprite.x = pos.x;
    sprite.y = pos.y;
  }
};
