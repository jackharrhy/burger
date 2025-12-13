import * as Pixi from "pixi.js";

export type GameEntity = {
  sprite: Pixi.Sprite;
  body?: any; // Rapier RigidBody
  collider?: any; // Rapier Collider
};
