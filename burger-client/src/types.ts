import type RAPIER from "@dimforge/rapier2d-compat";
import * as Pixi from "pixi.js";

export type GameEntity = {
  sprite: Pixi.Sprite;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
};
