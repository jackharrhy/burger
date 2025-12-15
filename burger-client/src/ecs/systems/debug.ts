import { query } from "bitecs";
import type { GameWorld } from "../world";
import { debugGraphics, showDebug } from "../../setup";
import { getRapierWorld } from "./physics";
import {
  Position,
  FacingDirection,
  Sprite,
  FollowsEntity,
  InteractionZone,
} from "../components";
import { PLAYER_SIZE } from "../../vars";

export const interactionZoneDebugSystem = (world: GameWorld): void => {
  for (const eid of query(world, [
    InteractionZone,
    FollowsEntity,
    Position,
    Sprite,
  ])) {
    const targetEid = FollowsEntity.target[eid];
    if (!targetEid) continue;

    const sprite = Sprite[eid];
    if (!sprite) continue;

    const interactionX =
      Position.x[targetEid] + FacingDirection.x[targetEid] * PLAYER_SIZE;
    const interactionY =
      Position.y[targetEid] + FacingDirection.y[targetEid] * PLAYER_SIZE;

    Position.x[eid] = interactionX;
    Position.y[eid] = interactionY;
    sprite.x = interactionX;
    sprite.y = interactionY;
  }
};

export const debugRenderSystem = (_world: GameWorld): void => {
  debugGraphics.clear();

  if (!showDebug) return;

  const rapierWorld = getRapierWorld();
  if (!rapierWorld) return;

  const { vertices, colors } = rapierWorld.debugRender();

  for (let i = 0; i < vertices.length / 4; i += 1) {
    const vertexIndex = i * 4;
    const colorIndex = i * 8;

    const color = [
      colors[colorIndex],
      colors[colorIndex + 1],
      colors[colorIndex + 2],
      colors[colorIndex + 3],
    ];

    debugGraphics
      .setStrokeStyle({ width: 2, color })
      .moveTo(vertices[vertexIndex], vertices[vertexIndex + 1])
      .lineTo(vertices[vertexIndex + 2], vertices[vertexIndex + 3])
      .stroke();
  }
};
