import { query } from "bitecs";
import debugFactory from "debug";
import { Player, Input, FacingDirection } from "../components";
import type { GameWorld } from "../world";
import { sendInteract, isConnected } from "../../network";

const debug = debugFactory("burger:ecs:systems:interaction");

export const interactionSystem = (world: GameWorld): void => {
  if (!isConnected()) return;

  for (const eid of query(world, [Player, Input, FacingDirection])) {
    if (!Input.interactPressed[eid]) continue;

    debug("Interact pressed - sending to server");
    sendInteract();
  }
};
