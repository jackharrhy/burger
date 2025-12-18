import { addEntity, addComponent, type World } from "bitecs";
import { TILE_SIZE, TILE_TYPES, type sharedComponents, createPhysicsWall } from "burger-shared";
import invariant from "tiny-invariant";

const MAZE_LAYOUT = [
  "####################",
  "#..................#",
  "#..###..######..#..#",
  "#....#.......#..#..#",
  "#....#..###..#..#..#",
  "#....#..#.#..#.....#",
  "#.......#.#.....####",
  "####....#.####.....#",
  "#.......#......#...#",
  "#..######..#####...#",
  "#..........#.......#",
  "#..##..##..#...#####",
  "#...#...#..#.......#",
  "#...#...#..........#",
  "####################",
];

export const MAZE_WIDTH = 20;
export const MAZE_HEIGHT = 15;

export const createMaze = (
  world: World<{ components: typeof sharedComponents }>,
): void => {
  const { Position, Tile, Solid, Networked } = world.components;

  const offsetX = -(MAZE_WIDTH * TILE_SIZE) / 2 + TILE_SIZE / 2;
  const offsetY = -(MAZE_HEIGHT * TILE_SIZE) / 2 + TILE_SIZE / 2;

  for (let y = 0; y < MAZE_HEIGHT; y++) {
    const row = MAZE_LAYOUT[y];
    for (let x = 0; x < MAZE_WIDTH; x++) {
      invariant(row);
      const char = row[x];
      if (char === "#") {
        const eid = addEntity(world as any);

        addComponent(world as any, eid, Position);
        Position.x[eid] = offsetX + x * TILE_SIZE;
        Position.y[eid] = offsetY + y * TILE_SIZE;

        addComponent(world as any, eid, Solid);
        addComponent(world as any, eid, Networked);

        // Create physics wall
        createPhysicsWall(
          world as any,
          eid,
          offsetX + x * TILE_SIZE,
          offsetY + y * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE
        );

        // Add tile component for identification
        addComponent(world as any, eid, Tile);
        Tile.type[eid] = TILE_TYPES.WALL;
      }
    }
  }
};
