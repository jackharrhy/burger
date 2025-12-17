import debugFactory from "debug";
import { MESSAGE_TYPES } from "burger-shared";
import { createWorld, addEntity, addComponent, removeEntity } from "bitecs";
import {
  createObserverSerializer,
  createSnapshotSerializer,
  createSoASerializer,
  f32,
  str,
} from "bitecs/serialization";

const debug = debugFactory("burger:main");

const world = createWorld({
  components: {
    Player: { name: str([]) },
    Position: { x: f32([]), y: f32([]) },
    Velocity: { x: f32([]), y: f32([]) },
    Networked: {},
  },
  time: {
    delta: 0,
    elapsed: 0,
    then: performance.now(),
  },
});

type World = typeof world;

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

const observerSerializers = new Map();

const { Player, Position, Velocity } = world.components;
const networkedComponents = [Player, Position, Velocity];
const snapshotSerializer = createSnapshotSerializer(world, networkedComponents);

const playerEntities = new Map();

const tagMessage = (type: number, data: ArrayBuffer) => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

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

      const newPlayer = createPlayer(world, "Marty");

      playerEntities.set(ws, newPlayer);

      const { Networked } = world.components;
      observerSerializers.set(
        ws,
        createObserverSerializer(world, Networked, networkedComponents),
      );

      ws.send(
        tagMessage(MESSAGE_TYPES.YOUR_EID, new Int32Array([newPlayer]).buffer),
      );

      const snapshot = snapshotSerializer();
      ws.send(tagMessage(MESSAGE_TYPES.SNAPSHOT, snapshot));
    },
    close(ws) {
      console.log("client disconnected");
      const playerEntity = playerEntities.get(ws);
      removeEntity(world, playerEntity);
      playerEntities.delete(ws);
      observerSerializers.delete(ws);
    },
    message(ws, message) {
      const playerEntity = playerEntities.get(ws);
      debug("received message from client from", playerEntity);

      const observerSerializer = observerSerializers.get(ws);
      const updates = observerSerializer();
      if (updates.byteLength > 0) {
        debug("sending OBSERVER update");
        ws.send(tagMessage(MESSAGE_TYPES.OBSERVER, updates));
      }
    },
  },
});

console.log(`WebSocket server running on ${server.hostname}:${server.port}`);
