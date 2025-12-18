import { addComponent, removeEntity } from "bitecs";
import { Box, Circle, Vec2 } from "planck";
import { PLAYER_SIZE, TILE_SIZE } from "./consts.shared";
import { PhysicsBody, PhysicsShape, PhysicsVelocity } from "./ecs.shared";
import { getPhysicsWorld } from "./physics.shared";
import type { World } from "./types.shared";

export const createPhysicsPlayer = (
  world: World,
  eid: number,
  x: number,
  y: number,
): void => {
  addComponent(world, eid, PhysicsBody);
  addComponent(world, eid, PhysicsShape);
  addComponent(world, eid, PhysicsVelocity);

  PhysicsShape.shapeType[eid] = "circle";
  PhysicsShape.radius[eid] = PLAYER_SIZE / 2;
  PhysicsShape.density[eid] = 1.0;
  PhysicsShape.friction[eid] = 0.3;
  PhysicsShape.restitution[eid] = 0.0;
  PhysicsShape.isSensor[eid] = false;
  PhysicsBody.bodyType[eid] = "dynamic";
  PhysicsBody.dirty[eid] = false;

  PhysicsVelocity.linearVelocity[eid] = new Vec2(0, 0);
  PhysicsVelocity.angularVelocity[eid] = 0;
  PhysicsVelocity.force[eid] = new Vec2(0, 0);
  PhysicsVelocity.torque[eid] = 0;

  const physicsWorld = getPhysicsWorld();
  const body = physicsWorld.createBody({
    type: "dynamic",
    position: { x, y },
    linearDamping: 0,
    angularDamping: 0,
  });

  body.createFixture({
    shape: new Circle(PLAYER_SIZE / 2),
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
  });

  PhysicsBody.bodyRef[eid] = body;
};

export const createPhysicsWall = (
  world: any,
  eid: number,
  x: number,
  y: number,
  width: number = TILE_SIZE,
  height: number = TILE_SIZE,
): void => {
  addComponent(world, eid, PhysicsBody);
  addComponent(world, eid, PhysicsShape);

  PhysicsShape.shapeType[eid] = "box";
  PhysicsShape.width[eid] = width;
  PhysicsShape.height[eid] = height;
  PhysicsShape.density[eid] = 0;
  PhysicsShape.friction[eid] = 0.3;
  PhysicsShape.restitution[eid] = 0.0;
  PhysicsShape.isSensor[eid] = false;
  PhysicsBody.bodyType[eid] = "static";
  PhysicsBody.dirty[eid] = false;

  const physicsWorld = getPhysicsWorld();
  const body = physicsWorld.createBody({
    type: "static",
    position: { x, y },
  });

  body.createFixture({
    shape: new Box(width / 2, height / 2),
    density: 0,
    friction: 0.3,
    restitution: 0.0,
  });

  PhysicsBody.bodyRef[eid] = body;
};

export const destroyPhysicsEntity = (world: any, eid: number): void => {
  const body = PhysicsBody.bodyRef[eid];
  if (body) {
    const physicsWorld = getPhysicsWorld();
    physicsWorld.destroyBody(body);
    PhysicsBody.bodyRef[eid] = null;
  }

  removeEntity(world, eid);
};
