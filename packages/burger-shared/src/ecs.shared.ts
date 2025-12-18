import { f32, str } from "bitecs/serialization";
import { Body, Vec2 } from "planck";
import type { TileType } from "./consts.shared";

export const Player = { name: str([]) };
export const Position = { x: f32([]), y: f32([]) };
export const Velocity = { x: f32([]), y: f32([]) };
export const Networked = {};
export const Tile = { type: [] as TileType[keyof TileType][] };
export const Solid = {};

export const PhysicsBody = {
  bodyRef: [] as (Body | null)[],
  bodyType: [] as ("static" | "dynamic" | "kinematic")[],
  dirty: [] as boolean[],
};

export const PhysicsShape = {
  shapeType: [] as ("circle" | "box" | "polygon")[],
  width: [] as number[],
  height: [] as number[],
  radius: [] as number[],
  density: [] as number[],
  friction: [] as number[],
  restitution: [] as number[],
  isSensor: [] as boolean[],
};

export const PhysicsVelocity = {
  linearVelocity: [] as Vec2[],
  angularVelocity: [] as number[],
  force: [] as Vec2[],
  torque: [] as number[],
};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Networked,
  Tile,
  Solid,
  PhysicsBody,
  PhysicsShape,
  PhysicsVelocity,
};

export const networkedComponents = [Player, Position, Tile, Solid];
