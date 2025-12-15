import type * as Pixi from "pixi.js";
import type RAPIER from "@dimforge/rapier2d-compat";

// Re-export all shared components
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

// Client-specific components (require PixiJS/Rapier types)
export const Sprite = [] as (Pixi.Sprite | null)[];
export const RigidBody = [] as (RAPIER.RigidBody | null)[];
export const Collider = [] as (RAPIER.Collider | null)[];
export const CharacterController =
  [] as (RAPIER.KinematicCharacterController | null)[];
