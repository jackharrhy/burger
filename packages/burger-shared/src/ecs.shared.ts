import { str } from "bitecs/serialization";
import type { TileType } from "./const.shared";

export const MAX_ENTITIES = 2000;

const Player = { name: str([]) };

const Position = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};
const Velocity = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};
const AudioEmitter = { peerId: new Int32Array(MAX_ENTITIES) };
const Tile = { type: [] as TileType[] };

const Networked = {};
const Solid = {};
const Bot = {};
const Radio = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Tile,
  Networked,
  Solid,
  Bot,
  Radio,
  AudioEmitter,
};

export const networkedComponents = [
  Player,
  Position,
  Tile,
  Solid,
  Bot,
  Radio,
  AudioEmitter,
];
