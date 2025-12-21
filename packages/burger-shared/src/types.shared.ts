export type InputCmd = {
  seq: number; // monotonic sequence number for reconciliation
  msec: number; // delta time in ms
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  interact: boolean;
};

export type PlayerState = {
  eid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastInputSeq: number;
};

export type GameStateMessage = {
  players: PlayerState[];
};

export type SignalMessage = {
  from: number;
  to: number;
  signal: unknown;
};
