import { query } from "bitecs";
import { Player, Position } from "../components";
import type { GameWorld } from "../world";
import { CAMERA_ZOOM } from "../../vars";
import { pixi, worldContainer } from "../../setup";

export const cameraOffset = { x: 0, y: 0 };

export const cameraSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Player, Position])) {
    cameraOffset.x = Position.x[eid] - pixi.screen.width / 2 / CAMERA_ZOOM;
    cameraOffset.y = Position.y[eid] - pixi.screen.height / 2 / CAMERA_ZOOM;

    worldContainer.scale.set(CAMERA_ZOOM);
    worldContainer.x = -cameraOffset.x * CAMERA_ZOOM;
    worldContainer.y = -cameraOffset.y * CAMERA_ZOOM;

    break;
  }
};
