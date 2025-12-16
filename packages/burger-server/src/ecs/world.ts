import { createWorld as createBitECSWorld, createEntityIndex } from "bitecs";
import {
  Position,
  Velocity,
  FacingDirection,
  Input,
  CookingTimer,
  HeldBy,
  SittingOn,
  Player,
  Holdable,
  Counter,
  Stove,
  UncookedPatty,
  CookedPatty,
  NetworkId,
  Networked,
} from "@burger-king/shared";

export const createServerWorld = () => {
  return createBitECSWorld(createEntityIndex(), {
    components: {
      Position,
      Velocity,
      FacingDirection,
      Input,
      CookingTimer,
      HeldBy,
      SittingOn,
      Player,
      Holdable,
      Counter,
      Stove,
      UncookedPatty,
      CookedPatty,
      NetworkId,
      Networked,
    },
    time: { delta: 0, elapsed: 0, then: Date.now() },
  });
};

export type ServerWorld = ReturnType<typeof createServerWorld>;
