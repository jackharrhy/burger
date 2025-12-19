import { f32, str } from "bitecs/serialization";
import type { TileType } from "./const.shared";

const Player = { name: str([]) };
const Position = { x: f32([]), y: f32([]) };
const Velocity = { x: f32([]), y: f32([]) };
const Tile = { type: [] as TileType[] };
const Networked = {};
const Solid = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Tile,
  Networked,
  Solid,
};

export const networkedComponents = [Player, Position, Tile, Solid];
