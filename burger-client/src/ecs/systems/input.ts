import { query } from "bitecs";
import debugFactory from "debug";
import { Player, Input } from "../components";
import type { GameWorld } from "../world";

const debug = debugFactory("burger:ecs:systems:input");

export const inputSystem = (world: GameWorld): void => {
  const { keys } = world;

  const interactDown = keys[" "] || keys["space"] || false;
  const interactPressed = interactDown && !world.prevInteract;

  if (interactPressed) {
    debug("Interact pressed! Keys: %o", keys);
  }

  world.prevInteract = interactDown;

  for (const eid of query(world, [Player, Input])) {
    Input.up[eid] = keys["w"] || keys["arrowup"] ? 1 : 0;
    Input.down[eid] = keys["s"] || keys["arrowdown"] ? 1 : 0;
    Input.left[eid] = keys["a"] || keys["arrowleft"] ? 1 : 0;
    Input.right[eid] = keys["d"] || keys["arrowright"] ? 1 : 0;
    Input.interact[eid] = interactDown ? 1 : 0;
    Input.interactPressed[eid] = interactPressed ? 1 : 0;
  }
};

export const setupInputListeners = (world: GameWorld): void => {
  window.addEventListener("keydown", (e) => {
    world.keys[e.key.toLowerCase()] = true;
  });

  window.addEventListener("keyup", (e) => {
    world.keys[e.key.toLowerCase()] = false;
  });
};
