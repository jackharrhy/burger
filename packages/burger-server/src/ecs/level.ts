import {
  loadLevelData,
  getRawLevelData,
  entityTypeToItemType,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "@burger-king/shared";
import debugFactory from "debug";
import { query } from "bitecs";
import { Counter, Position, Surface } from "@burger-king/shared";
import type { ServerWorld } from "./world";
import {
  createServerCounter,
  createServerItem,
  createServerWall,
  createServerFloor,
  createEntityFromRegistry,
  isRegisteredEntityType,
} from "./entities";

const debug = debugFactory("burger:server:level");

export type LevelSetup = {
  itemEids: Map<string, number>;
  counterEids: Map<string, number>;
  surfaceEids: Map<string, number>;
  playerSpawn: { x: number; y: number };
};

export const setupServerLevel = (world: ServerWorld): LevelSetup => {
  const levelDataResult = loadLevelData();
  const itemEids = new Map<string, number>();
  const counterEids = new Map<string, number>();
  const surfaceEids = new Map<string, number>();

  const rawLevelData = getRawLevelData();
  const level = rawLevelData.levels[0];
  const worldLayer = level.layerInstances.find(
    (layer: { __identifier: string }) => layer.__identifier === "World"
  );

  if (!worldLayer) {
    throw new Error("World layer not found");
  }

  let wallCount = 0;
  let floorCount = 0;

  for (const tile of worldLayer.gridTiles) {
    const x = tile.px[0];
    const y = tile.px[1];

    switch (tile.t) {
      case 0: // Wall
        createServerWall(world, x, y);
        wallCount++;
        break;
      case 1: // Floor
        createServerFloor(world, x, y);
        floorCount++;
        break;
      case 6: {
        const centerX = x + TILE_WIDTH / 2;
        const centerY = y + TILE_HEIGHT / 2;
        const counterEid = createServerCounter(world, x, y);
        counterEids.set(`${centerX},${centerY}`, counterEid);
        break;
      }
    }
  }

  debug("Created %d walls and %d floors", wallCount, floorCount);

  // Process all surface entity types (Stove, Bin, PattyBox, OrderWindow)
  debug(
    "Level data has %d surfaces to process",
    levelDataResult.surfaces.length
  );

  for (const surfaceEntity of levelDataResult.surfaces) {
    const entityType = surfaceEntity.type;

    if (!isRegisteredEntityType(entityType)) {
      debug(
        "Skipping surface %s - unknown type %s",
        surfaceEntity.id,
        entityType
      );
      continue;
    }

    debug(
      "Processing surface %s type=%s at (%d, %d)",
      surfaceEntity.id,
      entityType,
      surfaceEntity.x,
      surfaceEntity.y
    );

    const surfaceEid = createEntityFromRegistry(
      world,
      entityType,
      surfaceEntity.x,
      surfaceEntity.y,
      {
        stock: surfaceEntity.stock,
        spawnType: surfaceEntity.spawnType,
      }
    );
    surfaceEids.set(surfaceEntity.id, surfaceEid);
  }

  debug("Level data has %d items to process", levelDataResult.items.length);

  // Find surface (stove or counter) at position for item placement
  const findSurfaceAtPosition = (x: number, y: number): number => {
    // First check surfaces (stoves, etc.)
    for (const [_id, surfaceEid] of surfaceEids) {
      const sx = Position.x[surfaceEid];
      const sy = Position.y[surfaceEid];
      const dx = Math.abs(sx - x);
      const dy = Math.abs(sy - y);
      if (dx <= TILE_WIDTH / 2 && dy <= TILE_HEIGHT / 2) {
        return surfaceEid;
      }
    }
    // Then check counters
    for (const [posKey, cid] of counterEids) {
      const [cx, cy] = posKey.split(",").map(Number);
      const dx = Math.abs(cx - x);
      const dy = Math.abs(cy - y);
      if (dx <= TILE_WIDTH / 2 && dy <= TILE_HEIGHT / 2) {
        return cid;
      }
    }
    return 0;
  };

  for (const entityItem of levelDataResult.items) {
    const itemType = entityTypeToItemType(entityItem.type);
    if (!itemType) {
      debug(
        "Skipping item %s - unknown type %s",
        entityItem.id,
        entityItem.type
      );
      continue;
    }

    debug(
      "Processing item %s type=%s at (%d, %d)",
      entityItem.id,
      entityItem.type,
      entityItem.x,
      entityItem.y
    );

    const surfaceEid = findSurfaceAtPosition(entityItem.x, entityItem.y);

    if (surfaceEid === 0) {
      debug(
        "No surface found for item at (%d, %d)",
        entityItem.x,
        entityItem.y
      );
      continue;
    }

    const itemEid = createServerItem(
      world,
      entityItem.id,
      itemType,
      entityItem.x,
      entityItem.y,
      surfaceEid
    );
    itemEids.set(entityItem.id, itemEid);
  }

  const playerSpawn = levelDataResult.playerSpawn || { x: 104, y: 104 };

  debug(
    "Server level setup: %d counters, %d surfaces, %d items",
    counterEids.size,
    surfaceEids.size,
    itemEids.size
  );

  return { itemEids, counterEids, surfaceEids, playerSpawn };
};

export const findCounterAtPosition = (
  world: ServerWorld,
  x: number,
  y: number
): number => {
  for (const counterEid of query(world, [Counter])) {
    const counterX = Position.x[counterEid];
    const counterY = Position.y[counterEid];
    const dx = Math.abs(counterX - x);
    const dy = Math.abs(counterY - y);

    if (dx < TILE_WIDTH / 2 && dy < TILE_HEIGHT / 2) {
      return counterEid;
    }
  }
  return 0;
};
