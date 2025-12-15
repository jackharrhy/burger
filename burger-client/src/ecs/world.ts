import { createWorld as createBitECSWorld, createEntityIndex } from "bitecs";
import {
  Position,
  Velocity,
  FacingDirection,
  Input,
  HeldBy,
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
  Sprite,
  RigidBody,
  Collider,
  CharacterController,
  NetworkId,
} from "./components";

export const entityIndex = createEntityIndex();

export const createGameWorld = () => {
  const world = createBitECSWorld(entityIndex, {
    components: {
      Position,
      Velocity,
      FacingDirection,
      Input,
      HeldBy,
      CookingTimer,
      FollowsEntity,
      NetworkId,

      Player,
      InteractionZone,
      Holdable,
      Counter,
      Wall,
      Stove,
      Floor,
      CookedPatty,
      UncookedPatty,

      Sprite,
      RigidBody,
      Collider,
      CharacterController,
    },
    time: {
      delta: 0,
      elapsed: 0,
      then: performance.now(),
    },
    physics: {
      accumulator: 0,
      timestep: 1 / 60,
    },
    keys: {} as Record<string, boolean>,
    prevInteract: false,
  });

  return world;
};

export type GameWorld = ReturnType<typeof createGameWorld>;
