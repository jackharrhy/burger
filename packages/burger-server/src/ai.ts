import invariant from "tiny-invariant";
import { addEntity, addComponent } from "bitecs";
import { moveAndSlide } from "burger-shared";
import type { World } from "./server";

const AI_COUNT = 10;
const WANDER_RADIUS = 200;
const AI_SPEED = 0.15;
const DIRECTION_CHANGE_INTERVAL = 2000;

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

    aiEntities.push({
      eid,
      targetAngle: Math.random() * Math.PI * 2,
      nextDirectionChange:
        performance.now() + Math.random() * DIRECTION_CHANGE_INTERVAL,
    });
  }

  console.log(`Spawned ${AI_COUNT} AI bots`);
};

export const updateAiPlayers = (world: World, tickRateMs: number): void => {
  const { Position, Velocity } = world.components;
  const now = performance.now();

  for (const ai of aiEntities) {
    const { eid } = ai;

    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);

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

    Velocity.x[eid] = Math.cos(ai.targetAngle) * AI_SPEED;
    Velocity.y[eid] = Math.sin(ai.targetAngle) * AI_SPEED;

    const newPos = moveAndSlide(
      world,
      Position.x[eid],
      Position.y[eid],
      Velocity.x[eid],
      Velocity.y[eid],
      tickRateMs,
    );
    Position.x[eid] = newPos.x;
    Position.y[eid] = newPos.y;
  }
};

export const getAiEntities = (): AiState[] => aiEntities;
