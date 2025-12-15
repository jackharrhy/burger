import { query } from "bitecs";
import { Position, Sprite, RigidBody } from "../components";
import type { GameWorld } from "../world";

export const renderSyncSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Position, Sprite, RigidBody])) {
    const rigidBody = RigidBody[eid];
    const sprite = Sprite[eid];

    if (!rigidBody || !sprite) continue;

    const pos = rigidBody.translation();
    Position.x[eid] = pos.x;
    Position.y[eid] = pos.y;

    sprite.x = pos.x;
    sprite.y = pos.y;
  }
};
