import { createRelation, makeExclusive } from "bitecs";
import { f32, u8, u32, str } from "bitecs/serialization";

export const Position = { x: f32([]), y: f32([]) };
export const Velocity = { x: f32([]), y: f32([]) };
export const FacingDirection = { x: f32([]), y: f32([]) };
export const CookingTimer = {
  elapsed: f32([]),
  duration: f32([]),
};

export const NetworkId = { id: str([]) };

export const Player = {};
export const Holdable = {};
export const Counter = {};
export const Wall = {};
export const Stove = {};
export const Floor = {};
export const CookedPatty = {};
export const UncookedPatty = {};
export const Networked = {};

// Surface behaviors (tag components)
export const Surface = {}; // Base: can be interacted with
export const AcceptsItems = {}; // Items can be placed here
export const DestroysItems = {}; // Items placed here are destroyed (bin)
export const SpawnsItems = {}; // Interact to get an item (box)
export const AcceptsOrders = {}; // Cooked patties fulfill orders here

// Bin entity tag
export const Bin = {};

// Box/spawner data components
export const ItemStock = { count: u8([]), maxCount: u8([]) };
export const SpawnType = { itemType: str([]) };

// Order system
export const Order = {
  requiredCount: u8([]), // How many patties needed
  fulfilledCount: u8([]), // How many delivered
  timeLimit: f32([]), // Optional time limit (0 = no limit)
  elapsed: f32([]), // Time elapsed
};
export const OrderQueue = {}; // Tag for order window entity
export const OrderWindow = {}; // Tag for order window visual

export const InteractionZone = {};

export const FollowsEntity = {
  target: u32([]),
  offsetX: f32([]),
  offsetY: f32([]),
};

export const Input = {
  up: u8([]),
  down: u8([]),
  left: u8([]),
  right: u8([]),
  interact: u8([]),
  interactPressed: u8([]),
};

export const HeldBy = createRelation(makeExclusive);
export const SittingOn = createRelation(makeExclusive);

export const networkedComponents = [
  Position,
  Velocity,
  FacingDirection,
  CookingTimer,
  NetworkId,

  Player,
  Holdable,
  HeldBy,
  SittingOn,
  Counter,
  Stove,
  Wall,
  Floor,
  CookedPatty,
  UncookedPatty,
  Networked,

  // Surface behaviors
  Surface,
  AcceptsItems,
  DestroysItems,
  SpawnsItems,
  AcceptsOrders,
  Bin,

  // Box/spawner
  ItemStock,
  SpawnType,

  // Order system
  Order,
  OrderQueue,
  OrderWindow,
];
