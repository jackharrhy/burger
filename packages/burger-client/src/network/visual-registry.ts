import { hasComponent } from "bitecs";
import {
  Player,
  Holdable,
  Stove,
  Wall,
  Floor,
  Counter,
  CookedPatty,
  DestroysItems,
  SpawnsItems,
  AcceptsOrders,
  Bin,
  OrderWindow,
} from "@burger-king/shared";
import type { GameWorld } from "../ecs/world";

export type ContainerType = "level" | "entity" | "player";

export type VisualConfig = {
  texture: string;
  container: ContainerType;
  hasCollider?: boolean;
  isPlayer?: boolean;
  isItem?: boolean;
};

type VisualCheck = {
  check: (world: GameWorld, eid: number) => boolean;
  getConfig: (world: GameWorld, eid: number) => VisualConfig;
};

// Order matters - more specific checks should come first
const visualRegistry: VisualCheck[] = [
  // Player (most specific - has special handling)
  {
    check: (w, e) => hasComponent(w, e, Player),
    getConfig: () => ({
      texture: "player",
      container: "player",
      hasCollider: true,
      isPlayer: true,
    }),
  },

  // Items (Holdable) - check cooked state
  {
    check: (w, e) => hasComponent(w, e, Holdable),
    getConfig: (w, e) => ({
      texture: hasComponent(w, e, CookedPatty) ? "cooked-patty" : "uncooked-patty",
      container: "entity",
      hasCollider: true,
      isItem: true,
    }),
  },

  // Stove
  {
    check: (w, e) => hasComponent(w, e, Stove),
    getConfig: () => ({
      texture: "stove",
      container: "entity",
      hasCollider: false,
    }),
  },

  // Bin (DestroysItems surface)
  {
    check: (w, e) => hasComponent(w, e, Bin) || hasComponent(w, e, DestroysItems),
    getConfig: () => ({
      texture: "bin",
      container: "level",
      hasCollider: true,
    }),
  },

  // Patty Box (SpawnsItems surface)
  {
    check: (w, e) => hasComponent(w, e, SpawnsItems),
    getConfig: () => ({
      texture: "patty-box",
      container: "level",
      hasCollider: true,
    }),
  },

  // Order Window (AcceptsOrders surface)
  {
    check: (w, e) => hasComponent(w, e, OrderWindow) || hasComponent(w, e, AcceptsOrders),
    getConfig: () => ({
      texture: "order-window",
      container: "level",
      hasCollider: true,
    }),
  },

  // Regular Counter
  {
    check: (w, e) => hasComponent(w, e, Counter),
    getConfig: () => ({
      texture: "counter",
      container: "level",
      hasCollider: true,
    }),
  },

  // Wall
  {
    check: (w, e) => hasComponent(w, e, Wall),
    getConfig: () => ({
      texture: "red-brick",
      container: "level",
      hasCollider: true,
    }),
  },

  // Floor
  {
    check: (w, e) => hasComponent(w, e, Floor),
    getConfig: () => ({
      texture: "black-floor",
      container: "level",
      hasCollider: false,
    }),
  },
];

/**
 * Get the visual configuration for an entity based on its components.
 * Returns null if no matching visual configuration is found.
 */
export const getVisualConfig = (
  world: GameWorld,
  eid: number
): VisualConfig | null => {
  for (const entry of visualRegistry) {
    if (entry.check(world, eid)) {
      return entry.getConfig(world, eid);
    }
  }
  return null;
};

/**
 * Check if an entity should have visuals created.
 */
export const shouldHaveVisuals = (world: GameWorld, eid: number): boolean => {
  return getVisualConfig(world, eid) !== null;
};

