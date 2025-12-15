import type * as Pixi from "pixi.js";
import type RAPIER from "@dimforge/rapier2d-compat";

export {
  MAX_ENTITIES,
  Position,
  Velocity,
  FacingDirection,
  Input,
  HeldBy,
  SittingOn,
  CookingTimer,
  FollowsEntity,
  Player,
  InteractionZone,
  Holdable,
  Counter,
  Wall,
  Stove,
  Floor,
  CookedPatty,
  UncookedPatty,
  NetworkId,
} from "@burger-king/shared";

export const Sprite = [] as (Pixi.Sprite | null)[];
export const RigidBody = [] as (RAPIER.RigidBody | null)[];
export const Collider = [] as (RAPIER.Collider | null)[];
export const CharacterController =
  [] as (RAPIER.KinematicCharacterController | null)[];
