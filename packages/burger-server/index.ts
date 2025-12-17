import debugFactory from "debug";
import {
  sharedComponents,
  MESSAGE_TYPES,
  networkedComponents,
  applyInputToVelocity,
  applyVelocityToPosition,
  type InputCmd,
  type GameStateMessage,
  type PlayerState,
} from "burger-shared";
import {
  createWorld,
  addEntity,
  addComponent,
  removeEntity,
  query,
} from "bitecs";
import {
  createObserverSerializer,
  createSnapshotSerializer,
} from "bitecs/serialization";
import type { ServerWebSocket } from "bun";
import { spawnAiPlayers, updateAiPlayers, getAiEntities } from "./ai";

const debug = debugFactory("burger:server");

// =============================================================================
// World Setup
// =============================================================================

const world = createWorld({
  components: {
    ...sharedComponents,
  },
  time: {
    delta: 0,
    elapsed: 0,
    then: performance.now(),
  },
});

type World = typeof world;

// =============================================================================
// Player Management
// =============================================================================

const createPlayer = (world: World, name: string) => {
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

// =============================================================================
// Network State
// =============================================================================

type PlayerConnection = {
  eid: number;
  inputQueue: InputCmd[];
  lastAckedSeq: number;
};

const playerConnections = new Map<ServerWebSocket<unknown>, PlayerConnection>();
const observerSerializers = new Map<
  ServerWebSocket<unknown>,
  () => ArrayBuffer
>();

const snapshotSerializer = createSnapshotSerializer(world, networkedComponents);

// =============================================================================
// Message Helpers
// =============================================================================

const tagMessage = (type: number, data: ArrayBuffer): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

const encodeGameState = (message: GameStateMessage): ArrayBuffer => {
  const json = JSON.stringify(message);
  const encoder = new TextEncoder();
  return encoder.encode(json).buffer;
};

// =============================================================================
// WebSocket Server
// =============================================================================

const server = Bun.serve({
  port: 5001,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("Upgrade failed", { status: 500 });
  },
  websocket: {
    open(ws) {
      console.log("client connected");

      const eid = createPlayer(world, "Marty");

      playerConnections.set(ws, {
        eid,
        inputQueue: [],
        lastAckedSeq: -1,
      });

      const { Networked } = world.components;
      observerSerializers.set(
        ws,
        createObserverSerializer(world, Networked, networkedComponents),
      );

      // Send the player their entity ID
      ws.send(tagMessage(MESSAGE_TYPES.YOUR_EID, new Int32Array([eid]).buffer));

      // Send initial world snapshot
      const snapshot = snapshotSerializer();
      ws.send(tagMessage(MESSAGE_TYPES.SNAPSHOT, snapshot));
    },

    close(ws) {
      console.log("client disconnected");
      const connection = playerConnections.get(ws);
      if (connection) {
        removeEntity(world, connection.eid);
      }
      playerConnections.delete(ws);
      observerSerializers.delete(ws);
    },

    message(ws, message) {
      const connection = playerConnections.get(ws);
      if (!connection) return;

      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case "input": {
            const cmd: InputCmd = {
              seq: data.seq,
              msec: data.msec,
              up: data.up,
              down: data.down,
              left: data.left,
              right: data.right,
              interact: data.interact,
            };
            connection.inputQueue.push(cmd);

            // Prevent queue from growing too large (anti-cheat / memory safety)
            if (connection.inputQueue.length > 128) {
              connection.inputQueue.shift();
            }
            break;
          }
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    },
  },
});

// =============================================================================
// Game Tick (40Hz - Authoritative Physics)
// =============================================================================

const TICK_RATE_MS = 1000 / 40; // 40Hz = 25ms

const gameTick = () => {
  const { Position, Velocity } = world.components;

  // Update AI players first
  updateAiPlayers(world, TICK_RATE_MS);

  // Process inputs for each connected player
  for (const [_ws, connection] of playerConnections) {
    const { eid, inputQueue } = connection;

    // Process all queued inputs
    for (const cmd of inputQueue) {
      // Apply input to velocity
      const newVel = applyInputToVelocity(
        Velocity.x[eid],
        Velocity.y[eid],
        cmd,
        cmd.msec,
      );
      Velocity.x[eid] = newVel.vx;
      Velocity.y[eid] = newVel.vy;

      // Apply velocity to position
      const newPos = applyVelocityToPosition(
        Position.x[eid],
        Position.y[eid],
        Velocity.x[eid],
        Velocity.y[eid],
        cmd.msec,
      );
      Position.x[eid] = newPos.x;
      Position.y[eid] = newPos.y;

      // Track the last processed input sequence
      connection.lastAckedSeq = cmd.seq;
    }

    // Clear the input queue after processing
    connection.inputQueue = [];
  }

  // Build game state for all players (real players + AI bots)
  const playerStates: PlayerState[] = [];

  // Add real players
  for (const [_ws, connection] of playerConnections) {
    const { eid, lastAckedSeq } = connection;
    playerStates.push({
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.x[eid],
      vy: Velocity.y[eid],
      lastInputSeq: lastAckedSeq,
    });
  }

  // Add AI players (they don't have input sequences)
  for (const ai of getAiEntities()) {
    const { eid } = ai;
    playerStates.push({
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.x[eid],
      vy: Velocity.y[eid],
      lastInputSeq: -1, // AI has no client inputs
    });
  }

  if (playerConnections.size === 0) return; // No clients to send to

  const gameState: GameStateMessage = { players: playerStates };
  const encodedState = encodeGameState(gameState);
  const taggedState = tagMessage(MESSAGE_TYPES.GAME_STATE, encodedState);

  // Broadcast to all clients
  for (const [ws] of playerConnections) {
    ws.send(taggedState);

    // Also send observer updates for entity add/remove
    const observerSerializer = observerSerializers.get(ws);
    if (observerSerializer) {
      const updates = observerSerializer();
      if (updates.byteLength > 0) {
        ws.send(tagMessage(MESSAGE_TYPES.OBSERVER, updates));
      }
    }
  }
};

// =============================================================================
// Server Startup
// =============================================================================

// Spawn AI players on startup
spawnAiPlayers(world);

// Start game loop
setInterval(gameTick, TICK_RATE_MS);

console.log(`WebSocket server running on ${server.hostname}:${server.port}`);
