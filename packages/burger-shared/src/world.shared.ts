import { createWorld } from "bitecs";
import { sharedComponents } from "./ecs.shared";

const sharedWorldDefaults = () => ({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: Date.now() },
});

export const createSharedWorld = <Extra extends object>(extra: Extra) =>
  createWorld({ ...sharedWorldDefaults(), ...extra });

export type SharedWorld = {
  components: typeof sharedComponents;
  time: { delta: number; elapsed: number; then: number };
};
