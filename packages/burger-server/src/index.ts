import { WebSocketServer, WebSocket } from "ws";
import debugFactory from "debug";
import { query, removeEntity } from "bitecs";
import {
  setupCookingObservers,
  Networked,
  Position,
  MessageType,
  TILE_WIDTH,
} from "@burger-king/shared";
import { createServerWorld, type ServerWorld } from "./ecs/world";
import { setupServerLevel, type LevelSetup } from "./ecs/level";
import { createServerPlayer } from "./ecs/entities";
import { cookingSystem } from "./ecs/systems/cooking";
import {
  createSerializers,
  createClientObserver,
  tagMessage,
  type Serializers,
  type ClientObserver,
} from "./network/serializers";
import {
  handleMessage,
  handlePlayerDisconnect,
  type ClientMessage,
  type ClientInfo,
} from "./network/messages";
import { unregisterPlayerMapping, getNetworkId } from "./ecs/sync";

const debug = debugFactory("burger:server");

const PORT = 2567;
const TICK_RATE = 20;

let world: ServerWorld;
let levelSetup: LevelSetup;
let serializers: Serializers;

type ClientState = ClientInfo & {
  ws: WebSocket;
  observer: ClientObserver;
};

const clients = new Map<WebSocket, ClientState>();

const initialize = () => {
  debug("Initializing server...");

  world = createServerWorld();
  levelSetup = setupServerLevel(world);
  setupCookingObservers(world);
  serializers = createSerializers(world);

  debug(
    "Server initialized: %d counters, %d stoves, %d items",
    levelSetup.counterEids.size,
    levelSetup.stoveEids.size,
    levelSetup.itemEids.size
  );
};

const startServer = () => {
  const wss = new WebSocketServer({ port: PORT });

  wss.on("connection", (ws: WebSocket) => {
    const sessionId = crypto.randomUUID();
    debug("Client connected: %s", sessionId);

    const offset = clients.size * TILE_WIDTH;
    const playerX = levelSetup.playerSpawn.x + offset;
    const playerY = levelSetup.playerSpawn.y;
    const playerEid = createServerPlayer(world, sessionId, playerX, playerY);
    const networkId = getNetworkId(sessionId)!;

    const observer = createClientObserver(world);

    const clientState: ClientState = {
      sessionId,
      playerEid,
      networkId,
      ws,
      observer,
    };
    clients.set(ws, clientState);

    const welcomeData = JSON.stringify({
      type: "welcome",
      networkId,
      sessionId,
    });
    ws.send(welcomeData);

    const snapshot = serializers.snapshot();
    ws.send(tagMessage(MessageType.SNAPSHOT, snapshot));

    debug("Sent welcome + snapshot to %s (networkId=%s)", sessionId, networkId);

    ws.on("message", (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        const client = clients.get(ws);
        if (client) {
          handleMessage(world, client, message, levelSetup.itemEids);
        }
      } catch (e) {
        debug("Failed to parse message: %s", e);
      }
    });

    ws.on("close", () => {
      debug("Client disconnected: %s", sessionId);
      const client = clients.get(ws);
      if (client) {
        handlePlayerDisconnect(world, client.playerEid, levelSetup.itemEids);
        removeEntity(world, client.playerEid);
        unregisterPlayerMapping(sessionId);

        clients.delete(ws);
      }
    });

    ws.on("error", (error) => {
      debug("WebSocket error for %s: %s", sessionId, error);
    });
  });

  debug("WebSocket server running on port %d", PORT);
};

let lastTime = Date.now();

const gameLoop = () => {
  const now = Date.now();
  const deltaMs = now - lastTime;
  const deltaSeconds = deltaMs / 1000;
  lastTime = now;

  cookingSystem(world, deltaSeconds);

  broadcastState();
};

const broadcastState = () => {
  if (clients.size === 0) return;

  const networkedEntities = query(world, [Networked, Position]);
  const soaData = serializers.soa(Array.from(networkedEntities));

  for (const [_ws, client] of clients) {
    const { ws, observer } = client;

    if (ws.readyState !== WebSocket.OPEN) continue;

    const observerData = observer();
    if (observerData.byteLength > 0) {
      ws.send(tagMessage(MessageType.OBSERVER, observerData));
    }

    ws.send(tagMessage(MessageType.SOA, soaData));
  }
};

initialize();
startServer();

setInterval(gameLoop, 1000 / TICK_RATE);

debug("Server started!");
