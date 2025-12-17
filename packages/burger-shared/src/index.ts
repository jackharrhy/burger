import { f32, str } from "bitecs/serialization";

// =============================================================================
// Physics Constants (shared between client and server for determinism)
// =============================================================================

export const PLAYER_SPEED = 0.4;
export const ACCELERATION = 0.012;
export const FRICTION = 0.015;
export const TILE_SIZE = 32;
export const PLAYER_SIZE = TILE_SIZE;

// =============================================================================
// Message Types
// =============================================================================

export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  YOUR_EID: 3,
  INPUT: 4,
  GAME_STATE: 5,
} as const;

// =============================================================================
// Input Command (client -> server)
// =============================================================================

export interface InputCmd {
  seq: number; // monotonic sequence number for reconciliation
  msec: number; // delta time in ms
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  interact: boolean;
}

// =============================================================================
// Game State (server -> client)
// =============================================================================

export interface PlayerState {
  eid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastInputSeq: number;
}

export interface GameStateMessage {
  players: PlayerState[];
}

// =============================================================================
// Physics Helper (shared for prediction + authoritative simulation)
// =============================================================================

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * Math.min(t, 1);

export const applyInputToVelocity = (
  vx: number,
  vy: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
): { vx: number; vy: number } => {
  let targetX = 0;
  let targetY = 0;

  if (input.left) targetX -= 1;
  if (input.right) targetX += 1;
  if (input.up) targetY -= 1;
  if (input.down) targetY += 1;

  // Normalize diagonal movement
  if (targetX !== 0 && targetY !== 0) {
    const len = Math.sqrt(targetX * targetX + targetY * targetY);
    targetX /= len;
    targetY /= len;
  }

  targetX *= PLAYER_SPEED;
  targetY *= PLAYER_SPEED;

  const isMoving = targetX !== 0 || targetY !== 0;
  const blend = isMoving ? ACCELERATION : FRICTION;

  return {
    vx: lerp(vx, targetX, blend * dt),
    vy: lerp(vy, targetY, blend * dt),
  };
};

export const applyVelocityToPosition = (
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  return {
    x: x + vx * dt,
    y: y + vy * dt,
  };
};

// =============================================================================
// ECS Components
// =============================================================================

const Player = { name: str([]) };
const Position = { x: f32([]), y: f32([]) };
const Velocity = { x: f32([]), y: f32([]) };
const Networked = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Networked,
};

// Only Player and Position needed for initial snapshot
// Velocity is sent in GAME_STATE messages
export const networkedComponents = [Player, Position];
