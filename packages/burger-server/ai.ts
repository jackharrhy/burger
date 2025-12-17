import debugFactory from "debug";
import { addEntity, addComponent, query } from "bitecs";
import { sharedComponents } from "burger-shared";

const debug = debugFactory("burger:ai");

// =============================================================================
// Configuration
// =============================================================================

const AI_COUNT = 10;
const WANDER_RADIUS = 200; // pixels from origin
const AI_SPEED = 0.15; // slower than players
const DIRECTION_CHANGE_INTERVAL = 2000; // ms between direction changes

// =============================================================================
// Types
// =============================================================================

interface AiState {
  eid: number;
  targetAngle: number; // current movement direction (radians)
  nextDirectionChange: number; // timestamp for next direction change
}

// World type (matches server's world structure)
type World = ReturnType<
  typeof import("bitecs").createWorld<{
    components: typeof sharedComponents;
    time: { delta: number; elapsed: number; then: number };
  }>
>;

// =============================================================================
// State
// =============================================================================

const aiEntities: AiState[] = [];

// =============================================================================
// Spawn AI Players
// =============================================================================

export const spawnAiPlayers = (world: World): void => {
  const { Player, Position, Velocity, Networked } = world.components;

  for (let i = 0; i < AI_COUNT; i++) {
    const eid = addEntity(world);

    // Add components (same as regular players)
    addComponent(world, eid, Player);
    Player.name[eid] = `Bot ${i + 1}`;

    addComponent(world, eid, Position);
    // Start at random position within radius
    const startAngle = Math.random() * Math.PI * 2;
    const startDist = Math.random() * WANDER_RADIUS * 0.5; // Start in inner half
    Position.x[eid] = Math.cos(startAngle) * startDist;
    Position.y[eid] = Math.sin(startAngle) * startDist;

    addComponent(world, eid, Velocity);
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;

    addComponent(world, eid, Networked);

    // Track AI state
    const aiState: AiState = {
      eid,
      targetAngle: Math.random() * Math.PI * 2,
      nextDirectionChange:
        performance.now() +
        Math.random() * DIRECTION_CHANGE_INTERVAL,
    };
    aiEntities.push(aiState);

    debug(
      "Spawned AI bot %d at (%.1f, %.1f)",
      i + 1,
      Position.x[eid],
      Position.y[eid],
    );
  }

  debug("Spawned %d AI players", AI_COUNT);
};

// =============================================================================
// Update AI Players
// =============================================================================

export const updateAiPlayers = (world: World, tickRateMs: number): void => {
  const { Position, Velocity } = world.components;
  const now = performance.now();

  for (const ai of aiEntities) {
    const { eid } = ai;

    // Calculate distance from center
    const distFromCenter = Math.sqrt(
      Position.x[eid] ** 2 + Position.y[eid] ** 2,
    );

    const nearEdge = distFromCenter > WANDER_RADIUS * 0.8;
    const timeToChange = now > ai.nextDirectionChange;

    // Change direction if near edge or timer expired
    if (nearEdge || timeToChange) {
      if (nearEdge) {
        // Point back toward center with some randomness
        ai.targetAngle = Math.atan2(-Position.y[eid], -Position.x[eid]);
        ai.targetAngle += (Math.random() - 0.5) * Math.PI * 0.5; // ±45° variance
      } else {
        // Random direction
        ai.targetAngle = Math.random() * Math.PI * 2;
      }

      // Set next direction change time
      ai.nextDirectionChange =
        now +
        DIRECTION_CHANGE_INTERVAL +
        Math.random() * DIRECTION_CHANGE_INTERVAL;
    }

    // Set velocity based on target angle
    Velocity.x[eid] = Math.cos(ai.targetAngle) * AI_SPEED;
    Velocity.y[eid] = Math.sin(ai.targetAngle) * AI_SPEED;

    // Apply velocity to position (using tick rate as delta time)
    Position.x[eid] += Velocity.x[eid] * tickRateMs;
    Position.y[eid] += Velocity.y[eid] * tickRateMs;
  }
};

// =============================================================================
// Get AI Entity IDs (for including in GAME_STATE)
// =============================================================================

export const getAiEntities = (): AiState[] => {
  return aiEntities;
};

