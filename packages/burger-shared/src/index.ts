import { f32, str } from "bitecs/serialization";

export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  SOA: 2,
  YOUR_EID: 3,
};

const Player = { name: str([]) };
const Position = { x: f32([]), y: f32([]) };
const Velocity = { x: f32([]), y: f32([]) };
const Networked = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Networked,
};

export const networkedComponents = [Player, Position, Velocity];
