import { addComponent, addEntity } from "bitecs";
import type { World } from "./server";
import { randomItem } from "./utils";
import invariant from "tiny-invariant";

export const createPlayer = (world: World, name: string): number => {
  const { Player, Position, Velocity, Networked, AudioEmitter } =
    world.components;
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  Player.name[eid] = name;

  const spawn = randomItem(world.playerSpawns);
  invariant(spawn);

  addComponent(world, eid, Position);
  Position.x[eid] = spawn.x;
  Position.y[eid] = spawn.y;

  addComponent(world, eid, Velocity);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;

  addComponent(world, eid, Networked);

  addComponent(world, eid, AudioEmitter);
  AudioEmitter.peerId[eid] = eid;

  return eid;
};
