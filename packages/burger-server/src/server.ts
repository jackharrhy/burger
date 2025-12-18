import invariant from "tiny-invariant";
import {
  sharedComponents,
  applyInputToVelocity,
  moveAndSlide,
  type PlayerState,
} from "burger-shared";
import { createWorld, addEntity, addComponent, removeEntity } from "bitecs";
import {
  createServer,
  getPlayerConnections,
  processPlayerInputs,
  broadcastGameState,
} from "./network.server";
import { spawnAiPlayers, updateAiPlayers, getAiEntities } from "./ai";
import { createMaze } from "./maze";

const world = createWorld({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: performance.now() },
});

export type World = typeof world;

const createPlayer = (world: World, name: string): number => {
  const { Player, Position, Velocity, Networked } = world.components;
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  Player.name[eid] = name;

  addComponent(world, eid, Position);
  Position.x[eid] = 0;
  Position.y[eid] = 0;

  addComponent(world, eid, Velocity);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;

  addComponent(world, eid, Networked);

  return eid;
};

const TICK_RATE_MS = 1000 / 40;

const gameTick = () => {
  const { Position, Velocity } = world.components;

  updateAiPlayers(world, TICK_RATE_MS);

  processPlayerInputs(world, (eid, cmd) => {
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);

    const newVel = applyInputToVelocity(
      Velocity.x[eid],
      Velocity.y[eid],
      cmd,
      cmd.msec,
    );
    Velocity.x[eid] = newVel.vx;
    Velocity.y[eid] = newVel.vy;

    const newPos = moveAndSlide(
      world,
      Position.x[eid],
      Position.y[eid],
      Velocity.x[eid],
      Velocity.y[eid],
      cmd.msec,
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

  broadcastGameState({ playerStates });
};

createMaze(world);

createServer({
  port: 5001,
  world,
  onPlayerJoin: () => createPlayer(world, "Player"),
  onPlayerLeave: (eid) => removeEntity(world, eid),
});

spawnAiPlayers(world);

setInterval(gameTick, TICK_RATE_MS);
