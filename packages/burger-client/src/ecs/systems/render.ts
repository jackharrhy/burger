import { query, hasComponent } from "bitecs";
import { Sprite, RigidBody, Position } from "../components";
import type { GameWorld } from "../world";

export const renderSyncSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Sprite])) {
    const sprite = Sprite[eid];
    if (!sprite) continue;

    const rigidBody = RigidBody[eid];
    if (rigidBody) {
      const pos = rigidBody.translation();
      sprite.x = pos.x;
      sprite.y = pos.y;
    } else if (hasComponent(world, eid, Position)) {
      sprite.x = Position.x[eid];
      sprite.y = Position.y[eid];
    }
  }
};
