import { Vec2, Body, type BodyType, type ShapeType } from "planck";

export const PhysicsBody = {
  bodyRef: null as Body | null,
  bodyType: "dynamic" as BodyType,
  dirty: false,
};

export const PhysicsShape = {
  shapeType: "box" as ShapeType,
  width: 0,
  height: 0,
  radius: 0,
  density: 1.0,
  friction: 0.3,
  restitution: 0.0,
  isSensor: false,
};

export const PhysicsVelocity = {
  linearVelocity: { x: 0, y: 0 } as Vec2,
  angularVelocity: 0,
  force: { x: 0, y: 0 } as Vec2,
  torque: 0,
};
