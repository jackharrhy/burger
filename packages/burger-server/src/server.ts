import invariant from "tiny-invariant";
import { Vec2 } from "planck";
import {
  sharedComponents,
  applyInputToVelocity,
  physicsSystem,
  resetPhysicsDirtyFlags,
  createPhysicsPlayer,
  createPhysicsWall,
  destroyPhysicsEntity,
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
import debugFactory from "debug";
import { TICK_RATE_MS } from "burger-shared";

const debug = debugFactory("burger:server");

const world = createWorld({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: performance.now() },
});

export type World = typeof world;

const createPlayer = (world: World, name: string): number => {
  const { Player, Networked, Position, Velocity } = world.components;
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  Player.name[eid] = name;

  addComponent(world, eid, Networked);

  addComponent(world, eid, Position);
  Position.x[eid] = 0;
  Position.y[eid] = 0;

  addComponent(world, eid, Velocity);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;

  // Create physics player
  createPhysicsPlayer(world, eid, 0, 0);

  debug("created player: eid=%s name=%s", eid, name);

  return eid;
};

const gameTick = () => {
  const { Position, Velocity, PhysicsVelocity } = world.components;

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
      TICK_RATE_MS,
    );

    // Set physics velocity instead of direct velocity
    PhysicsVelocity.linearVelocity[eid] = new Vec2(newVel.vx, newVel.vy);
  });

  // Run physics simulation
  physicsSystem(world, TICK_RATE_MS / 1000);

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

  // Reset dirty flags for next frame
  resetPhysicsDirtyFlags(world);
};

createMaze(world);

createServer({
  port: 5001,
  world,
  onPlayerJoin: () => createPlayer(world, "Player"),
  onPlayerLeave: (eid) => destroyPhysicsEntity(world, eid),
});

spawnAiPlayers(world);

setInterval(gameTick, TICK_RATE_MS);
