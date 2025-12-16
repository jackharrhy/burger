import {
  loadLevelData,
  getRawLevelData,
  entityTypeToItemType,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "@burger-king/shared";
import debugFactory from "debug";
import { query } from "bitecs";
import { Counter, Position } from "@burger-king/shared";
import type { ServerWorld } from "./world";
import {
  createServerCounter,
  createServerStove,
  createServerItem,
  createServerWall,
  createServerFloor,
} from "./entities";

const debug = debugFactory("burger:server:level");

export type LevelSetup = {
  itemEids: Map<string, number>;
  stoveEids: Map<string, number>;
  counterEids: Map<string, number>;
  playerSpawn: { x: number; y: number };
};

export const setupServerLevel = (world: ServerWorld): LevelSetup => {
  const levelDataResult = loadLevelData();
  const itemEids = new Map<string, number>();
  const stoveEids = new Map<string, number>();
  const counterEids = new Map<string, number>();

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

  debug("Level data has %d stoves to process", levelDataResult.stoves.length);

  for (const stoveEntity of levelDataResult.stoves) {
    const stoveX = stoveEntity.x;
    const stoveY = stoveEntity.y;

    debug("Processing stove at (%d, %d)", stoveX, stoveY);

    let counterEid = 0;
    for (const [posKey, cid] of counterEids) {
      const [cx, cy] = posKey.split(",").map(Number);
      const dx = Math.abs(cx - stoveX);
      const dy = Math.abs(cy - stoveY);
      if (dx <= TILE_WIDTH / 2 && dy <= TILE_HEIGHT / 2) {
        counterEid = cid;
        debug("Matched stove to counter %d at (%d, %d)", cid, cx, cy);
        break;
      }
    }

    if (counterEid === 0) {
      debug("No counter found for stove at (%d, %d)", stoveX, stoveY);
      continue;
    }

    const stoveEid = createServerStove(world, stoveX, stoveY, counterEid);
    stoveEids.set(stoveEntity.id, stoveEid);
  }

  debug("Level data has %d items to process", levelDataResult.items.length);

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

    let counterEid = 0;
    for (const [posKey, cid] of counterEids) {
      const [cx, cy] = posKey.split(",").map(Number);
      const dx = Math.abs(cx - entityItem.x);
      const dy = Math.abs(cy - entityItem.y);
      if (dx <= TILE_WIDTH / 2 && dy <= TILE_HEIGHT / 2) {
        counterEid = cid;
        debug("Matched item to counter %d at (%d, %d)", cid, cx, cy);
        break;
      }
    }

    if (counterEid === 0) {
      debug(
        "No counter found for item at (%d, %d). Available counters:",
        entityItem.x,
        entityItem.y
      );
      for (const [posKey, cid] of counterEids) {
        debug("  Counter %d at %s", cid, posKey);
      }
      continue;
    }

    const itemEid = createServerItem(
      world,
      entityItem.id,
      itemType,
      entityItem.x,
      entityItem.y,
      counterEid
    );
    itemEids.set(entityItem.id, itemEid);
  }

  const playerSpawn = levelDataResult.playerSpawn || { x: 104, y: 104 };

  debug(
    "Server level setup: %d counters, %d stoves, %d items",
    counterEids.size,
    stoveEids.size,
    itemEids.size
  );

  return { itemEids, stoveEids, counterEids, playerSpawn };
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
