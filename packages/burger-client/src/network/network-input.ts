import { query } from "bitecs";
import {
  Player,
  Input,
  CharacterController,
  RigidBody,
} from "../ecs/components";
import type { GameWorld } from "../ecs/world";
import { getRoom } from "./client";
import { sendInput } from "./player-sync";
import { getEntityPosition } from "../ecs/systems/physics";

export const networkInputSystem = (world: GameWorld): void => {
  const room = getRoom();
  if (!room) return;

  // Only send input for the local player (the one with CharacterController)
  for (const eid of query(world, [
    Player,
    Input,
    CharacterController,
    RigidBody,
  ])) {
    // Calculate movement direction from input
    let dx = 0;
    let dy = 0;

    if (Input.left[eid]) dx -= 1;
    if (Input.right[eid]) dx += 1;
    if (Input.up[eid]) dy -= 1;
    if (Input.down[eid]) dy += 1;

    // Get actual position after physics
    const pos = getEntityPosition(eid);

    sendInput(room, eid, dx, dy, pos.x, pos.y);
  }
};
