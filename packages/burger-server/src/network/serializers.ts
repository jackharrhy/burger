import { createSnapshotSerializer } from "bitecs/serialization";
import { networkedComponents, MessageType } from "@burger-king/shared";
import type { ServerWorld } from "../ecs/world";

export type Serializers = {
  snapshot: ReturnType<typeof createSnapshotSerializer>;
};

export const createSerializers = (world: ServerWorld): Serializers => {
  const snapshot = createSnapshotSerializer(world, networkedComponents);
  return { snapshot };
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
