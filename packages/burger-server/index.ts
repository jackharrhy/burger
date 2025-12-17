import debugFactory from "debug";
import {
  sharedComponents,
  MESSAGE_TYPES,
  networkedComponents,
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
  createSoASerializer,
  f32,
  str,
} from "bitecs/serialization";

const debug = debugFactory("burger:main");

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

const snapshotSerializer = createSnapshotSerializer(world, networkedComponents);
const soaSerializer = createSoASerializer(networkedComponents);

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
      const playerEid = playerEntities.get(ws);
      const data = JSON.parse(message.toString());
      const { Position, Velocity } = world.components;

      switch (data.type) {
        case "position": {
          Position.x[playerEid] = data.x;
          Position.y[playerEid] = data.y;
          Velocity.x[playerEid] = data.xVel;
          Velocity.y[playerEid] = data.yVel;
          break;
        }
      }
    },
  },
});

const TICK_RATE = 1000 / 20;

setInterval(() => {
  const { Networked, Position } = world.components;

  if (playerEntities.size === 0) return;

  const soaUpdates = soaSerializer(
    Array.from(query(world, [Networked, Position])),
  );
  const taggedSoa = tagMessage(MESSAGE_TYPES.SOA, soaUpdates);

  for (const [ws] of playerEntities) {
    ws.send(taggedSoa);

    const observerSerializer = observerSerializers.get(ws);
    const updates = observerSerializer();
    if (updates.byteLength > 0) {
      ws.send(tagMessage(MESSAGE_TYPES.OBSERVER, updates));
    }
  }
}, TICK_RATE);

console.log(`WebSocket server running on ${server.hostname}:${server.port}`);
