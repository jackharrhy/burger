import { createRelation, makeExclusive } from "bitecs";
import { f32, u8, u32, str } from "bitecs/serialization";

export const Position = { x: f32([]), y: f32([]) };
export const Velocity = { x: f32([]), y: f32([]) };
export const FacingDirection = { x: f32([]), y: f32([]) };
export const CookingTimer = {
  elapsed: f32([]),
  duration: f32([]),
};

export const NetworkId = { id: str([]) };

export const Player = {};
export const Holdable = {};
export const Counter = {};
export const Wall = {};
export const Stove = {};
export const Floor = {};
export const CookedPatty = {};
export const UncookedPatty = {};
export const Networked = {};

export const InteractionZone = {};

export const FollowsEntity = {
  target: u32([]),
  offsetX: f32([]),
  offsetY: f32([]),
};

export const Input = {
  up: u8([]),
  down: u8([]),
  left: u8([]),
  right: u8([]),
  interact: u8([]),
  interactPressed: u8([]),
};

export const HeldBy = createRelation(makeExclusive);
export const SittingOn = createRelation(makeExclusive);

export const networkedComponents = [
  Position,
  Velocity,
  FacingDirection,
  CookingTimer,
  NetworkId,

  Player,
  Holdable,
  HeldBy,
  SittingOn,
  Counter,
  Stove,
  Wall,
  Floor,
  CookedPatty,
  UncookedPatty,
  Networked,
];
