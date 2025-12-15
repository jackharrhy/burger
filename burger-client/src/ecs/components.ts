import type * as Pixi from "pixi.js";
import type RAPIER from "@dimforge/rapier2d-compat";
import { createRelation, makeExclusive } from "bitecs";

const MAX_ENTITIES = 10000;

export const Position = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};

export const Velocity = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};

export const FacingDirection = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};

export const Input = {
  up: new Uint8Array(MAX_ENTITIES),
  down: new Uint8Array(MAX_ENTITIES),
  left: new Uint8Array(MAX_ENTITIES),
  right: new Uint8Array(MAX_ENTITIES),
  interact: new Uint8Array(MAX_ENTITIES),
  interactPressed: new Uint8Array(MAX_ENTITIES),
};

// Relation: Item can only be held by ONE entity (exclusive)
export const HeldBy = createRelation(makeExclusive);

export const CookingTimer = {
  elapsed: new Float32Array(MAX_ENTITIES),
  duration: new Float32Array(MAX_ENTITIES),
};

// Relation: Item can only sit on ONE counter (exclusive)
export const SittingOn = createRelation(makeExclusive);

export const FollowsEntity = {
  target: new Uint32Array(MAX_ENTITIES),
  offsetX: new Float32Array(MAX_ENTITIES),
  offsetY: new Float32Array(MAX_ENTITIES),
};

export const Player = [] as true[];
export const InteractionZone = [] as true[];
export const Holdable = [] as true[];
export const Counter = [] as true[];
export const Wall = [] as true[];
export const Stove = [] as true[];
export const Floor = [] as true[];
export const CookedPatty = [] as true[];
export const UncookedPatty = [] as true[];

export const Sprite = [] as (Pixi.Sprite | null)[];
export const RigidBody = [] as (RAPIER.RigidBody | null)[];
export const Collider = [] as (RAPIER.Collider | null)[];

export const CharacterController =
  [] as (RAPIER.KinematicCharacterController | null)[];

export const NetworkId = {
  id: new Uint32Array(MAX_ENTITIES),
};
