/**
 * Authoritative server model, the server is the
 * single source of truth for all game state.
 *
 * 1. INPUT PROCESSING
 *    Clients send input commands
 *    The server queues these and processes them each tick.
 *    Each input has a sequence number for acknowledgment.
 *
 * 2. AUTHORITATIVE PHYSICS
 *    The server runs physics at (TICK_RATE)hz.
 *    All position/velocity updates happen here.
 *
 * 3. STATE BROADCAST
 *    Every tick, the server broadcasts GAME_STATE to all clients.
 *    This includes position, velocity, and last-acknowledged input seq.
 *    Clients use this to reconcile their predictions.
 *
 * 4. ENTITY SYNCHRONIZATION
 *    - SNAPSHOT: Full world state sent on connect
 *    - OBSERVER: Delta updates for entity add/remove
 *    - GAME_STATE: Authoritative positions
 */

import {
  MESSAGE_TYPES,
  networkedComponents,
  type InputCmd,
  type GameStateMessage,
  type PlayerState,
} from "burger-shared";
import {
  createObserverSerializer,
  createSnapshotSerializer,
} from "bitecs/serialization";
import type { ServerWebSocket } from "bun";
import type { World } from "./server";

export type PlayerConnection = {
  eid: number;
  inputQueue: InputCmd[];
  lastAckedSeq: number;
};

const playerConnections = new Map<ServerWebSocket<unknown>, PlayerConnection>();
const observerSerializers = new Map<
  ServerWebSocket<unknown>,
  () => ArrayBuffer
>();

let snapshotSerializer: () => ArrayBuffer;

const tagMessage = (type: number, data: ArrayBuffer): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

const encodeGameState = (message: GameStateMessage): ArrayBuffer => {
  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(message)).buffer;
};

export const createServer = ({
  port,
  world,
  onPlayerJoin,
  onPlayerLeave,
}: {
  port: number;
  world: World;
  onPlayerJoin: (eid: number) => number;
  onPlayerLeave: (eid: number) => void;
}) => {
  const { Networked } = world.components;

  snapshotSerializer = createSnapshotSerializer(world, networkedComponents);

  const server = Bun.serve({
    port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        console.log("client connected");

        const eid = onPlayerJoin(0);

        playerConnections.set(ws, {
          eid,
          inputQueue: [],
          lastAckedSeq: -1,
        });

        observerSerializers.set(
          ws,
          createObserverSerializer(world, Networked, networkedComponents),
        );

        ws.send(
          tagMessage(MESSAGE_TYPES.YOUR_EID, new Int32Array([eid]).buffer),
        );
        ws.send(tagMessage(MESSAGE_TYPES.SNAPSHOT, snapshotSerializer()));
      },

      close(ws) {
        console.log("client disconnected");
        const connection = playerConnections.get(ws);
        if (connection) {
          onPlayerLeave(connection.eid);
        }
        playerConnections.delete(ws);
        observerSerializers.delete(ws);
      },

      message(ws, message) {
        const connection = playerConnections.get(ws);
        if (!connection) return;

        try {
          const data = JSON.parse(message.toString());
          if (data.type === "input") {
            handleInputMessage(connection, data);
          }
        } catch (e) {
          console.error("Failed to parse message:", e);
        }
      },
    },
  });

  console.log(`Server running on ${server.hostname}:${server.port}`);
  return server;
};

const handleInputMessage = (connection: PlayerConnection, data: any): void => {
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

  if (connection.inputQueue.length > 128) {
    connection.inputQueue.shift();
  }
};

export const getPlayerConnections = () => playerConnections;

export const processPlayerInputs = (
  world: World,
  applyInput: (eid: number, cmd: InputCmd) => void,
): void => {
  for (const [_ws, connection] of playerConnections) {
    const { eid, inputQueue } = connection;

    for (const cmd of inputQueue) {
      applyInput(eid, cmd);
      connection.lastAckedSeq = cmd.seq;
    }

    connection.inputQueue = [];
  }
};

export const broadcastGameState = ({
  playerStates,
}: {
  playerStates: PlayerState[];
}): void => {
  if (playerConnections.size === 0) return;

  const gameState: GameStateMessage = { players: playerStates };
  const taggedState = tagMessage(
    MESSAGE_TYPES.GAME_STATE,
    encodeGameState(gameState),
  );

  for (const [ws] of playerConnections) {
    ws.send(taggedState);

    const observerSerializer = observerSerializers.get(ws);
    if (observerSerializer) {
      const updates = observerSerializer();
      if (updates.byteLength > 0) {
        ws.send(tagMessage(MESSAGE_TYPES.OBSERVER, updates));
      }
    }
  }
};
