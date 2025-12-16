import {
  createSnapshotSerializer,
  createObserverSerializer,
  createSoASerializer,
} from "bitecs/serialization";
import {
  networkedComponents,
  Networked,
  MessageType,
} from "@burger-king/shared";
import type { ServerWorld } from "../ecs/world";

export type Serializers = {
  snapshot: ReturnType<typeof createSnapshotSerializer>;
  soa: ReturnType<typeof createSoASerializer>;
};

export type ClientObserver = ReturnType<typeof createObserverSerializer>;

export const createSerializers = (world: ServerWorld): Serializers => {
  const snapshot = createSnapshotSerializer(world, networkedComponents);
  const soa = createSoASerializer(networkedComponents);
  return { snapshot, soa };
};

export const createClientObserver = (world: ServerWorld): ClientObserver => {
  return createObserverSerializer(world, Networked, networkedComponents);
};

export const tagMessage = (
  type: (typeof MessageType)[keyof typeof MessageType],
  data: ArrayBuffer
): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};
