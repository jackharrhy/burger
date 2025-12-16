import { query } from "bitecs";
import debugFactory from "debug";
import { Player, Input, FacingDirection } from "../components";
import type { GameWorld } from "../world";
import { sendInteract, isConnected } from "../../network";

const debug = debugFactory("burger:ecs:systems:interaction");

/**
 * Interaction system - sends interact intent to server when player presses interact button.
 * The server handles all interaction logic (pickup, drop, swap) and sends back the updated state.
 */
export const interactionSystem = (world: GameWorld): void => {
  if (!isConnected()) return;

  for (const eid of query(world, [Player, Input, FacingDirection])) {
    if (!Input.interactPressed[eid]) continue;

    debug("Interact pressed - sending to server");
    sendInteract();
  }
};
