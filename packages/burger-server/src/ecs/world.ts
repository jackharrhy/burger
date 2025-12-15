import { createWorld as createBitECSWorld, createEntityIndex } from "bitecs";
import {
  Position,
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
} from "@burger-king/shared";

export const createServerWorld = () => {
  return createBitECSWorld(createEntityIndex(), {
    components: {
      Position,
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
    },
    time: { delta: 0, elapsed: 0, then: Date.now() },
  });
};

export type ServerWorld = ReturnType<typeof createServerWorld>;
