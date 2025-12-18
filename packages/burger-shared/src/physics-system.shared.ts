import { query } from "bitecs";
import { Vec2 } from "planck";
import { Position, Velocity, PhysicsBody, PhysicsVelocity } from "./ecs.shared";
import { getPhysicsWorld } from "./physics.shared";
import type { World } from "./types.shared";

export const physicsSystem = (world: World, dt: number): void => {
  const physicsWorld = getPhysicsWorld();

  const dynamicEntities = query(world, [PhysicsBody, PhysicsVelocity]);
  for (let i = 0; i < dynamicEntities.length; i++) {
    const eid = dynamicEntities[i] as number;
    const body = PhysicsBody.bodyRef[eid];

    if (body && body.getType() === "dynamic") {
      const vel = PhysicsVelocity.linearVelocity[eid]!;
      const force = PhysicsVelocity.force[eid]!;

      if (force.x !== 0 || force.y !== 0) {
        body.applyForceToCenter(force, true);
        PhysicsVelocity.force[eid] = new Vec2(0, 0);
      }

      if (vel.x !== 0 || vel.y !== 0) {
        body.setLinearVelocity(vel);
      }

      if (PhysicsVelocity.angularVelocity[eid]! !== 0) {
        body.setAngularVelocity(PhysicsVelocity.angularVelocity[eid]!);
      }
    }
  }

  physicsWorld.step(dt);

  const allPhysicsEntities = query(world, [PhysicsBody, Position, Velocity]);
  for (let i = 0; i < allPhysicsEntities.length; i++) {
    const eid = allPhysicsEntities[i] as number;
    const body = PhysicsBody.bodyRef[eid];

    if (body) {
      const pos = body.getPosition();
      const vel = body.getLinearVelocity();

      Position.x[eid] = pos.x;
      Position.y[eid] = pos.y;
      Velocity.x[eid] = vel.x;
      Velocity.y[eid] = vel.y;

      if (eid === 0) PhysicsBody.dirty[eid] = true;
    }
  }
};

export const resetPhysicsDirtyFlags = (world: World): void => {
  const physicsEntities = query(world, [PhysicsBody]);
  for (let i = 0; i < physicsEntities.length; i++) {
    const eid = physicsEntities[i] as number;
    PhysicsBody.dirty[eid] = false;
  }
};
