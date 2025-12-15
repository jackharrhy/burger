import { query } from "bitecs";
import { Player, RigidBody } from "../components";
import type { GameWorld } from "../world";
import { CAMERA_ZOOM } from "../../vars";
import { pixi, worldContainer } from "../../setup";
import { getEntityPosition } from "./physics";

export const cameraOffset = { x: 0, y: 0 };

export const cameraSystem = (world: GameWorld): void => {
  for (const eid of query(world, [Player, RigidBody])) {
    const pos = getEntityPosition(eid);
    cameraOffset.x = pos.x - pixi.screen.width / 2 / CAMERA_ZOOM;
    cameraOffset.y = pos.y - pixi.screen.height / 2 / CAMERA_ZOOM;

    worldContainer.scale.set(CAMERA_ZOOM);
    worldContainer.x = -cameraOffset.x * CAMERA_ZOOM;
    worldContainer.y = -cameraOffset.y * CAMERA_ZOOM;

    break;
  }
};
