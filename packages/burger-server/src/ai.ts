import invariant from "tiny-invariant";
import { addEntity, addComponent } from "bitecs";
import { Vec2 } from "planck";
import { createPhysicsPlayer } from "burger-shared";
import type { World } from "./server";
import debugFactory from "debug";

const debug = debugFactory("burger:ai");

const AI_COUNT = 10;
const WANDER_RADIUS = 400;
const AI_SPEED = 100;
const DIRECTION_CHANGE_INTERVAL = 1000;

type AiState = {
  eid: number;
  targetAngle: number;
  nextDirectionChange: number;
};

const aiEntities: AiState[] = [];

export const spawnAiPlayers = (world: World): void => {
  const { Player, Position, Velocity, Networked } = world.components;

  for (let i = 0; i < AI_COUNT; i++) {
    const eid = addEntity(world);

    addComponent(world, eid, Player);
    Player.name[eid] = `Bot ${i + 1}`;

    addComponent(world, eid, Position);
    const startAngle = Math.random() * Math.PI * 2;
    const startDist = Math.random() * WANDER_RADIUS * 0.5;
    Position.x[eid] = Math.cos(startAngle) * startDist;
    Position.y[eid] = Math.sin(startAngle) * startDist;

    addComponent(world, eid, Velocity);
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;

    addComponent(world, eid, Networked);

    // Create physics for AI
    createPhysicsPlayer(world, eid, Position.x[eid], Position.y[eid]);

    aiEntities.push({
      eid,
      targetAngle: Math.random() * Math.PI * 2,
      nextDirectionChange:
        performance.now() + Math.random() * DIRECTION_CHANGE_INTERVAL,
    });
  }

  debug(`spawned ${AI_COUNT} ai bots`);
};

export const updateAiPlayers = (world: World, tickRateMs: number): void => {
  const { Position, PhysicsVelocity } = world.components;
  const now = performance.now();

  for (const ai of aiEntities) {
    const { eid } = ai;

    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);

    const distFromCenter = Math.sqrt(
      Position.x[eid] ** 2 + Position.y[eid] ** 2,
    );
    const nearEdge = distFromCenter > WANDER_RADIUS * 0.8;
    const timeToChange = now > ai.nextDirectionChange;

    if (nearEdge || timeToChange) {
      if (nearEdge) {
        ai.targetAngle = Math.atan2(-Position.y[eid], -Position.x[eid]);
        ai.targetAngle += (Math.random() - 0.5) * Math.PI * 0.5;
      } else {
        ai.targetAngle = Math.random() * Math.PI * 2;
      }
      ai.nextDirectionChange =
        now +
        DIRECTION_CHANGE_INTERVAL +
        Math.random() * DIRECTION_CHANGE_INTERVAL;
    }

    // Set physics velocity
    PhysicsVelocity.linearVelocity[eid] = new Vec2(
      Math.cos(ai.targetAngle) * AI_SPEED,
      Math.sin(ai.targetAngle) * AI_SPEED,
    );
  }
};

export const getAiEntities = (): AiState[] => aiEntities;
