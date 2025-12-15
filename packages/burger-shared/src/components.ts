import { createRelation, makeExclusive } from "bitecs";

export const MAX_ENTITIES = 10000;

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

export const HeldBy = createRelation(makeExclusive);
export const SittingOn = createRelation(makeExclusive);

export const CookingTimer = {
  elapsed: new Float32Array(MAX_ENTITIES),
  duration: new Float32Array(MAX_ENTITIES),
};

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

export const NetworkId = {
  id: new Uint32Array(MAX_ENTITIES),
};
