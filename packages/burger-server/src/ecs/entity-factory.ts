import { addEntity, addComponent } from "bitecs";
import {
  Position,
  NetworkId,
  Networked,
  Surface,
  AcceptsItems,
  DestroysItems,
  SpawnsItems,
  AcceptsOrders,
  ItemStock,
  SpawnType,
  OrderQueue,
  OrderWindow,
  Bin,
  Counter,
  Stove,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "@burger-king/shared";
import type { ServerWorld } from "./world";

export type EntityConfig = {
  stock?: number;
  spawnType?: string;
};

type ComponentDefinition = object | ((eid: number, config?: EntityConfig) => void);

// Registry mapping entity type strings to component configurations
const entityRegistry: Record<string, ComponentDefinition[]> = {
  Stove: [
    Surface,
    AcceptsItems, // Patties can be placed directly on stoves
    Stove,
    Counter, // For collision
  ],
  Bin: [
    Surface,
    DestroysItems,
    Counter, // For collision
    Bin,
  ],
  PattyBox: [
    Surface,
    SpawnsItems,
    Counter, // For collision
    // ItemStock and SpawnType are data components, initialized separately
  ],
  OrderWindow: [
    Surface,
    AcceptsOrders,
    OrderQueue,
    OrderWindow,
    Counter, // For collision
  ],
};

export const createEntityFromRegistry = (
  world: ServerWorld,
  type: string,
  x: number,
  y: number,
  config?: EntityConfig
): number => {
  const componentDefs = entityRegistry[type];
  if (!componentDefs) {
    throw new Error(`Unknown entity type: ${type}`);
  }

  const eid = addEntity(world);

  // Add base components
  addComponent(world, eid, Position);
  addComponent(world, eid, NetworkId);
  addComponent(world, eid, Networked);

  // Add all components from the registry
  for (const componentDef of componentDefs) {
    if (typeof componentDef === "function") {
      componentDef(eid, config);
    } else {
      addComponent(world, eid, componentDef);
    }
  }

  // Set position (centered on tile)
  Position.x[eid] = x + TILE_WIDTH / 2;
  Position.y[eid] = y + TILE_HEIGHT / 2;
  NetworkId.id[eid] = `${type.toLowerCase()}-${x}-${y}`;

  // Apply type-specific initialization
  if (type === "PattyBox") {
    addComponent(world, eid, ItemStock);
    addComponent(world, eid, SpawnType);
    ItemStock.count[eid] = config?.stock ?? 5;
    ItemStock.maxCount[eid] = config?.stock ?? 5;
    SpawnType.itemType[eid] = config?.spawnType ?? "uncooked-patty";
  }

  return eid;
};

// Helper to check if a type is in the registry
export const isRegisteredEntityType = (type: string): boolean => {
  return type in entityRegistry;
};

// Get all registered entity types
export const getRegisteredEntityTypes = (): string[] => {
  return Object.keys(entityRegistry);
};

