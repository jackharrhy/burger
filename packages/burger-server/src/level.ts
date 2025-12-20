import { addEntity, addComponent } from "bitecs";
import { TILE_TYPES, type TileType } from "burger-shared";
import invariant from "tiny-invariant";

import burgerLevel from "./burger.json";
import type { World } from "./server";

const parseTiles = (world: World) => {
  const tilesets = burgerLevel.defs.tilesets[0];
  invariant(tilesets);

  const idToType: Record<number, TileType> = {};

  tilesets.customData.forEach(({ tileId, data }) => {
    const parsedData = JSON.parse(data);
    const typeId =
      TILE_TYPES[parsedData.toUpperCase() as keyof typeof TILE_TYPES];
    invariant(typeId !== undefined);
    idToType[tileId] = typeId;
  });

  const level = burgerLevel.levels[0];
  invariant(level);
  const levelTiles = level.layerInstances[1];
  invariant(levelTiles);

  for (const { t, px, src } of levelTiles.gridTiles) {
    const [x, y] = px;
    invariant(x !== undefined);
    invariant(y !== undefined);
    const tileType = idToType[t];
    invariant(tileType !== undefined);

    world.typeIdToAtlasSrc[tileType] = [src[0]!, src[1]!];

    const { Position, Tile, Solid, Networked } = world.components;

    const eid = addEntity(world);

    addComponent(world, eid, Position);
    Position.x[eid] = x;
    Position.y[eid] = y;

    addComponent(world, eid, Tile);
    Tile.type[eid] = tileType;

    if (tileType === TILE_TYPES.WALL) {
      addComponent(world, eid, Solid);
    }

    if (tileType === TILE_TYPES.COUNTER) {
      addComponent(world, eid, Solid);
    }

    addComponent(world, eid, Networked);
  }
};

const parseEntities = (world: World) => {
  const entities = burgerLevel.defs.entities;
  const playerSpawn = entities.find((e) => e.identifier === "PlayerSpawn");
  invariant(playerSpawn);

  const level = burgerLevel.levels[0];
  invariant(level);
  const levelEntities = level.layerInstances[0];
  invariant(levelEntities);

  for (const entity of levelEntities.entityInstances) {
    switch (entity.__identifier) {
      case "PlayerSpawn":
        world.playerSpawns.push({
          x: entity.__worldX,
          y: entity.__worldY,
        });
        break;
    }
  }
};

export const createLevel = (world: World) => {
  parseTiles(world);
  parseEntities(world);
};
