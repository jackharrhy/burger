/**
 * CLIENT-SIDE PREDICTION
 * - The client immediately applies input locally
 * - Input commands are stored in a buffer
 *
 * SERVER AUTHORITY
 * - The server is the single source of truth.
 * - It processes client inputs, runs physics,
 *   and broadcasts authoritative state at (TICK_RATE)Hz.
 *
 * RECONCILIATION
 * When server state arrives, the client:
 * - Discards acknowledged inputs
 * - Resets to server position
 * - Replays unacknowledged inputs
 * - Smooths any prediction error over time
 *
 * INTERPOLATION
 * Remote players are rendered with a delay (INTERP_DELAY), interpolating
 * between received snapshots for smooth movement. When data runs out,
 * we extrapolate using velocity.
 *
 * Message Flow:
 *   Client -> Server: INPUT (input commands at (CLIENT_UPDATE_RATE)Hz
 *   Server -> Client: YOUR_EID (on connect, tells client their entity ID)
 *   Server -> Client: SNAPSHOT (initial world state)
 *   Server -> Client: OBSERVER (entity add/remove deltas)
 *   Server -> Client: GAME_STATE (authoritative positions at (TICK_RATE)Hz)
 */

import {
  MESSAGE_TYPES,
  networkedComponents,
  applyInputToVelocity,
  physicsSystem,
  type InputCmd,
  type GameStateMessage,
} from "burger-shared";
import { Vec2 } from "planck";
import {
  createObserverDeserializer,
  createSnapshotDeserializer,
} from "bitecs/serialization";
import {
  CLIENT_UPDATE_RATE,
  INTERP_HISTORY_MS,
  TELEPORT_THRESHOLD,
} from "./consts.client";
import type { World } from "./client";

export type PositionSnapshot = { x: number; y: number; time: number };

export type NetworkState = {
  socket: WebSocket | null;
  inputSeq: number;
  lastSentSeq: number;
  pendingInputs: InputCmd[];
  predictionError: { x: number; y: number };
  idMap: Map<number, number>; // Server EID -> Client EID
};

export type PlayerIdentity = {
  eid: number | null; // Client-side EID (after mapping)
  serverEid: number | null; // Server-side EID (before mapping)
};

export const setupSocket = ({
  world,
  network,
  me,
  onLocalPlayerReady,
  onSnapshotReceived,
}: {
  world: World;
  network: NetworkState;
  me: PlayerIdentity;
  onLocalPlayerReady: () => void;
  onSnapshotReceived: () => void;
}): void => {
  const { Networked } = world.components;
  const { idMap } = network;

  const snapshotDeserializer = createSnapshotDeserializer(
    world,
    networkedComponents,
  );
  const observerDeserializer = createObserverDeserializer(
    world,
    Networked,
    networkedComponents,
  );

  const socket = new WebSocket("ws://localhost:5001");
  socket.binaryType = "arraybuffer";
  network.socket = socket;

  socket.addEventListener("open", () => {
    console.log("connected to server");
  });

  socket.addEventListener("message", (event) => {
    const messageView = new Uint8Array(event.data);
    const type = messageView[0];
    const payload = messageView.slice(1).buffer as ArrayBuffer;

    switch (type) {
      case MESSAGE_TYPES.SNAPSHOT:
        snapshotDeserializer(payload, idMap);
        tryMapLocalPlayer(me, idMap, onLocalPlayerReady);
        onSnapshotReceived();
        break;

      case MESSAGE_TYPES.OBSERVER:
        observerDeserializer(payload, idMap);
        tryMapLocalPlayer(me, idMap, onLocalPlayerReady);
        break;

      case MESSAGE_TYPES.GAME_STATE: {
        const decoder = new TextDecoder();
        const json = decoder.decode(payload);
        const gameState: GameStateMessage = JSON.parse(json);
        reconcile(world, network, me, gameState);
        break;
      }

      case MESSAGE_TYPES.YOUR_EID: {
        const view = new Int32Array(payload);
        me.serverEid = view[0];
        break;
      }
    }
  });

  socket.addEventListener("close", () => {
    console.log("disconnected from server");
    network.socket = null;
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
};

const tryMapLocalPlayer = (
  me: PlayerIdentity,
  idMap: Map<number, number>,
  onReady: () => void,
): void => {
  if (me.serverEid !== null && me.eid === null) {
    const clientEid = idMap.get(me.serverEid);
    if (clientEid !== undefined) {
      me.eid = clientEid;
      onReady();
    }
  }
};

let lastSendTime = 0;

export const sendInputs = (
  network: NetworkState,
  meEid: number | null,
): void => {
  const now = performance.now();
  if (now - lastSendTime < CLIENT_UPDATE_RATE) return;
  lastSendTime = now;

  const { socket, pendingInputs, lastSentSeq } = network;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (meEid === null) return;

  const unsentInputs = pendingInputs.filter((cmd) => cmd.seq > lastSentSeq);
  if (unsentInputs.length === 0) return;

  for (const cmd of unsentInputs) {
    socket.send(JSON.stringify({ type: "input", ...cmd }));
  }

  network.lastSentSeq = unsentInputs[unsentInputs.length - 1].seq;
};

const reconcile = (
  world: World,
  network: NetworkState,
  me: PlayerIdentity,
  serverState: GameStateMessage,
): void => {
  const { Position, Velocity, PositionHistory, PhysicsVelocity } = world.components;
  const { idMap, pendingInputs, predictionError } = network;

  for (const playerState of serverState.players) {
    const serverEid = playerState.eid;
    const eid = idMap.get(serverEid);
    if (eid === undefined) continue;

    const isLocalPlayer = serverEid === me.serverEid;

    if (isLocalPlayer && me.eid !== null) {
      const predictedX = Position.x[eid];
      const predictedY = Position.y[eid];

      while (
        pendingInputs.length > 0 &&
        pendingInputs[0].seq <= playerState.lastInputSeq
      ) {
        pendingInputs.shift();
      }

      Position.x[eid] = playerState.x;
      Position.y[eid] = playerState.y;
      Velocity.x[eid] = playerState.vx;
      Velocity.y[eid] = playerState.vy;

      for (const cmd of pendingInputs) {
        const newVel = applyInputToVelocity(
          Velocity.x[eid],
          Velocity.y[eid],
          cmd,
          cmd.msec,
        );

        // Set physics velocity
        PhysicsVelocity.linearVelocity[eid] = new Vec2(newVel.vx, newVel.vy);

        // Step physics
        physicsSystem(world, cmd.msec / 1000);
      }

      const errorX = predictedX - Position.x[eid];
      const errorY = predictedY - Position.y[eid];
      const errorLen = Math.abs(errorX) + Math.abs(errorY);

      if (errorLen > TELEPORT_THRESHOLD) {
        predictionError.x = 0;
        predictionError.y = 0;
      } else {
        predictionError.x = errorX;
        predictionError.y = errorY;
      }
    } else {
      Position.x[eid] = playerState.x;
      Position.y[eid] = playerState.y;
      Velocity.x[eid] = playerState.vx;
      Velocity.y[eid] = playerState.vy;

      const history = PositionHistory[eid];
      if (history) {
        const now = performance.now();
        history.push({ x: playerState.x, y: playerState.y, time: now });

        const cutoffTime = now - INTERP_HISTORY_MS;
        while (history.length > 2 && history[0].time < cutoffTime) {
          history.shift();
        }
      }
    }
  }
};
