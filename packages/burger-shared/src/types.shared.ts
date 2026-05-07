export type InputCmd = {
  seq: number;
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
