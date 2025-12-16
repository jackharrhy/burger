import debugFactory from "debug";
import { createSnapshotDeserializer } from "bitecs/serialization";
import { hasComponent } from "bitecs";
import {
  networkedComponents,
  NetworkId,
  MessageType,
  Player,
  Holdable,
  Stove,
  Wall,
  Floor,
  Counter,
  CookedPatty,
} from "@burger-king/shared";
import type { GameWorld } from "../ecs/world";
import {
  addPlayerVisuals,
  addItemVisuals,
  addStoveVisuals,
  addWallVisuals,
  addFloorVisuals,
  addCounterVisuals,
} from "./visuals";

const debug = debugFactory("burger:client:network");

export type WelcomeMessage = {
  type: "welcome";
  networkId: string;
  sessionId: string;
};

export type MoveMessage = {
  type: "move";
  x: number;
  y: number;
  facingX: number;
  facingY: number;
};

export type InteractMessage = {
  type: "interact";
};

let ws: WebSocket | null = null;
let world: GameWorld | null = null;
let idMap: Map<number, number> = new Map(); // server eid → client eid
let localNetworkId: string = "";
let localSessionId: string = "";
let localPlayerEid: number = 0;
let connected: boolean = false;

let snapshotDeserializer: ReturnType<typeof createSnapshotDeserializer>;

const entitiesWithVisuals = new Set<number>();

export const connect = async (
  gameWorld: GameWorld,
  serverUrl: string = "ws://localhost:2567"
): Promise<void> => {
  return new Promise((resolve, reject) => {
    world = gameWorld;

    snapshotDeserializer = createSnapshotDeserializer(
      world,
      networkedComponents
    );

    ws = new WebSocket(serverUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      debug("WebSocket connected");
    };

    ws.onmessage = (event) => {
      handleMessage(event.data, resolve);
    };

    ws.onerror = (error) => {
      debug("WebSocket error:", error);
      reject(error);
    };

    ws.onclose = () => {
      debug("WebSocket closed");
      connected = false;
    };
  });
};

export const disconnect = (): void => {
  ws?.close();
  ws = null;
  connected = false;
  idMap.clear();
  entitiesWithVisuals.clear();
  localNetworkId = "";
  localSessionId = "";
  localPlayerEid = 0;
};

export const isConnected = (): boolean => connected;

export const getSessionId = (): string => localSessionId;

export const getLocalNetworkId = (): string => localNetworkId;

export const getLocalPlayerEid = (): number => localPlayerEid;

export const getIdMap = (): Map<number, number> => idMap;

export const sendMove = (
  x: number,
  y: number,
  facingX: number,
  facingY: number
): void => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const message: MoveMessage = { type: "move", x, y, facingX, facingY };
  ws.send(JSON.stringify(message));
};

export const sendInteract = (): void => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const message: InteractMessage = { type: "interact" };
  ws.send(JSON.stringify(message));
};

const handleMessage = (
  data: ArrayBuffer | string,
  onConnected?: () => void
): void => {
  if (typeof data === "string") {
    try {
      const message = JSON.parse(data) as WelcomeMessage;
      if (message.type === "welcome") {
        handleWelcome(message);
      }
    } catch (e) {
      debug("Failed to parse JSON message:", e);
    }
    return;
  }

  const view = new Uint8Array(data);
  if (view.length === 0) return;

  const messageType = view[0];
  const payload = view.slice(1).buffer;

  if (messageType === MessageType.SNAPSHOT) {
    snapshotDeserializer(payload, idMap);
    onSnapshotReceived();
    if (onConnected) {
      connected = true;
      onConnected();
    }
  }
};

const handleWelcome = (message: WelcomeMessage): void => {
  localNetworkId = message.networkId;
  localSessionId = message.sessionId;
  debug(
    "Welcome received: networkId=%s sessionId=%s",
    localNetworkId,
    localSessionId
  );
};

const onSnapshotReceived = (): void => {
  if (!world) return;

  findLocalPlayer();

  for (const [_serverEid, clientEid] of idMap) {
    ensureEntityVisuals(clientEid);
  }
};

const findLocalPlayer = (): void => {
  if (!world || !localNetworkId) return;

  for (const [_serverEid, clientEid] of idMap) {
    const networkId = NetworkId.id[clientEid];
    if (networkId === localNetworkId) {
      localPlayerEid = clientEid;

      break;
    }
  }
};

const ensureEntityVisuals = (eid: number): void => {
  if (!world) return;
  if (entitiesWithVisuals.has(eid)) return;

  const networkId = NetworkId.id[eid];

  if (hasComponent(world, eid, Player)) {
    const isLocal = networkId === localNetworkId;
    addPlayerVisuals(world, eid, isLocal);
    entitiesWithVisuals.add(eid);
    debug("Added player visuals: eid=%d isLocal=%s", eid, isLocal);
  } else if (hasComponent(world, eid, Holdable)) {
    const isCooked = hasComponent(world, eid, CookedPatty);
    addItemVisuals(world, eid, isCooked);
    entitiesWithVisuals.add(eid);
    debug("Added item visuals: eid=%d cooked=%s", eid, isCooked);
  } else if (hasComponent(world, eid, Stove)) {
    addStoveVisuals(world, eid);
    entitiesWithVisuals.add(eid);
    debug("Added stove visuals: eid=%d", eid);
  } else if (hasComponent(world, eid, Wall)) {
    addWallVisuals(world, eid);
    entitiesWithVisuals.add(eid);
  } else if (hasComponent(world, eid, Floor)) {
    addFloorVisuals(world, eid);
    entitiesWithVisuals.add(eid);
  } else if (hasComponent(world, eid, Counter)) {
    addCounterVisuals(world, eid);
    entitiesWithVisuals.add(eid);
    debug("Added counter visuals: eid=%d", eid);
  }
};
