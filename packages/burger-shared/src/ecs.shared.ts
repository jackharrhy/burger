import { f32, str } from "bitecs/serialization";
import type { TileType } from "./const.shared";

const Player = { name: str([]) };
const Position = { x: f32([]), y: f32([]) };
const Velocity = { x: f32([]), y: f32([]) };
const Networked = {};
const Tile = { type: [] as TileType[keyof TileType][] };
const Solid = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Networked,
  Tile,
  Solid,
};

export const networkedComponents = [Player, Position, Tile, Solid];
