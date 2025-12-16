export * from "./components";
export * from "./constants";
export * from "./systems/cooking-logic";
export * from "./systems/cooking";
export * from "./systems/interaction-helpers";
export * from "./level-loader";

export const MessageType = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  SOA: 2,
  WELCOME: 3,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];
