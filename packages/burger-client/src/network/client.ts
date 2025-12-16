import debugFactory from "debug";
import {
  createSnapshotDeserializer,
  createObserverDeserializer,
  createSoADeserializer,
} from "bitecs/serialization";
import { hasComponent, observe, onAdd } from "bitecs";
import {
  networkedComponents,
  Networked,
  NetworkId,
  MessageType,
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
  addBinVisuals,
  addPattyBoxVisuals,
  addOrderWindowVisuals,
  updateItemToCooked,
} from "./visuals";
import { getVisualConfig } from "./visual-registry";

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
let observerDeserializer: ReturnType<typeof createObserverDeserializer>;
let soaDeserializer: ReturnType<typeof createSoADeserializer>;

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
    observerDeserializer = createObserverDeserializer(
      world,
      Networked,
      networkedComponents
    );
    soaDeserializer = createSoADeserializer(networkedComponents);

    setupCookingObserver(world);

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

  switch (messageType) {
    case MessageType.SNAPSHOT:
      snapshotDeserializer(payload, idMap);
      onSnapshotReceived();
      if (onConnected) {
        connected = true;
        onConnected();
      }
      break;

    case MessageType.OBSERVER:
      observerDeserializer(payload, idMap);
      onObserverReceived();
      break;

    case MessageType.SOA:
      soaDeserializer(payload, idMap);
      break;
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

const onObserverReceived = (): void => {
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

  const config = getVisualConfig(world, eid);
  if (!config) return;

  const networkId = NetworkId.id[eid];

  // Use specific visual functions based on texture type
  // This allows for type-specific setup (colliders, etc.)
  switch (config.texture) {
    case "player":
      const isLocal = networkId === localNetworkId;
      addPlayerVisuals(world, eid, isLocal);
      debug("Added player visuals: eid=%d isLocal=%s", eid, isLocal);
      break;
    case "cooked-patty":
    case "uncooked-patty":
      const isCooked = hasComponent(world, eid, CookedPatty);
      addItemVisuals(world, eid, isCooked);
      debug("Added item visuals: eid=%d cooked=%s", eid, isCooked);
      break;
    case "stove":
      addStoveVisuals(world, eid);
      debug("Added stove visuals: eid=%d", eid);
      break;
    case "bin":
      addBinVisuals(world, eid);
      debug("Added bin visuals: eid=%d", eid);
      break;
    case "patty-box":
      addPattyBoxVisuals(world, eid);
      debug("Added patty-box visuals: eid=%d", eid);
      break;
    case "order-window":
      addOrderWindowVisuals(world, eid);
      debug("Added order-window visuals: eid=%d", eid);
      break;
    case "counter":
      addCounterVisuals(world, eid);
      debug("Added counter visuals: eid=%d", eid);
      break;
    case "red-brick":
      addWallVisuals(world, eid);
      break;
    case "black-floor":
      addFloorVisuals(world, eid);
      break;
    default:
      debug("Unknown texture type: %s for eid=%d", config.texture, eid);
      return;
  }

  entitiesWithVisuals.add(eid);
};

const setupCookingObserver = (gameWorld: GameWorld): void => {
  observe(gameWorld, onAdd(CookedPatty), (eid: number) => {
    debug("Patty became cooked: eid=%d", eid);
    updateItemToCooked(eid);
  });
};
