import invariant from "tiny-invariant";
import {
  applyInputToVelocity,
  moveAndSlide,
  type PlayerState,
  SERVER_TICK_RATE_MS,
} from "burger-shared";
import { removeEntity } from "bitecs";
import {
  createServer,
  getPlayerConnections,
  processPlayerInputs,
  broadcastGameState,
} from "./network.server";
import { spawnAiPlayers, updateAiPlayers, getAiEntities } from "./ai";
import { createPlayer } from "./players";
import { openDatabase } from "./db";
import { loadAuthConfig } from "./auth/config";
import { initWorld } from "./world";

const db = openDatabase();
const authConfig = loadAuthConfig();
const world = initWorld(db);

export type { World } from "./world";

let isIdle = false;

const activeTick = () => {
  const { Position, Velocity } = world.components;

  updateAiPlayers(world, SERVER_TICK_RATE_MS);

  processPlayerInputs((eid, cmd) => {
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);

    const newVel = applyInputToVelocity(
      Velocity.x[eid],
      Velocity.y[eid],
      cmd,
      SERVER_TICK_RATE_MS,
    );
    Velocity.x[eid] = newVel.vx;
    Velocity.y[eid] = newVel.vy;

    const newPos = moveAndSlide(
      world,
      Position.x[eid],
      Position.y[eid],
      Velocity.x[eid],
      Velocity.y[eid],
      SERVER_TICK_RATE_MS,
    );
    Position.x[eid] = newPos.x;
    Position.y[eid] = newPos.y;
  });

  const playerStates: PlayerState[] = [];

  for (const [_ws, connection] of getPlayerConnections()) {
    const { eid, lastAckedSeq } = connection;
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);

    playerStates.push({
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.x[eid],
      vy: Velocity.y[eid],
      lastInputSeq: lastAckedSeq,
    });
  }

  for (const ai of getAiEntities()) {
    const { eid } = ai;
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);

    playerStates.push({
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.x[eid],
      vy: Velocity.y[eid],
      lastInputSeq: -1,
    });
  }

  const hasPlayers = getPlayerConnections().size > 0;
  if (hasPlayers) {
    isIdle = false;
  } else {
    console.log("Switching to idle mode");
    isIdle = true;
  }

  broadcastGameState({ playerStates });

  setTimeout(
    isIdle ? idleTick : activeTick,
    isIdle ? 1000 : SERVER_TICK_RATE_MS,
  );
};

const idleTick = () => {
  const hasPlayers = getPlayerConnections().size > 0;
  if (hasPlayers) {
    console.log("Switching to active mode");
    isIdle = false;
    setTimeout(activeTick, SERVER_TICK_RATE_MS);
  } else {
    setTimeout(idleTick, 1000);
  }
};

const SERVER_PORT = 5000;

createServer({
  port: SERVER_PORT,
  world,
  db,
  authConfig,
  onPlayerJoin: (displayName: string) => createPlayer(world, displayName),
  onPlayerLeave: (eid) => removeEntity(world, eid),
});

spawnAiPlayers(world);

activeTick();
