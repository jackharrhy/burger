import "./style.css";

import debugFactory from "debug";
import { sharedComponents, MESSAGE_TYPES } from "burger-shared";
import {
  Application,
  Assets,
  Container,
  Sprite as PixiSprite,
  Texture,
} from "pixi.js";
import { createWorld, query, addComponent, observe, onAdd } from "bitecs";
import { ACCELERATION, FRICTION, PLAYER_SIZE, PLAYER_SPEED } from "./consts";
import {
  createObserverDeserializer,
  createSnapshotDeserializer,
  createSoADeserializer,
} from "bitecs/serialization";

const debug = debugFactory("burger:main");

const world = createWorld({
  components: {
    ...sharedComponents,
    Input: [] as {
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      interact: boolean;
      interactPressed: boolean;
    }[],
    Sprite: [] as (PixiSprite | null)[],
  },
  time: {
    delta: 0,
    elapsed: 0,
    then: performance.now(),
  },
});

type World = typeof world;
type Context = {
  world: World;
  app: Application;
  container: Container;
  assets: Awaited<ReturnType<typeof loadAssets>>;
  input: {
    keys: Record<string, boolean>;
    prevInteract: string | boolean;
  };
  me: {
    eid: number | null;
  };
};

declare global {
  interface Window {
    context: Context;
  }
}

const setupPlayerObserver = ({ world, assets, container, me }: Context) => {
  const { Player, Sprite, Input } = world.components;

  observe(world, onAdd(Player), (eid) => {
    if (me.eid === null) {
      throw new Error(
        "myEid is not set, this might have been us, but we don't know our eid yet!",
      );
    }

    if (eid === me.eid) {
      debug("setting up input for our own player");
      addComponent(world, eid, Input);
      Input[eid] = {
        up: false,
        down: false,
        left: false,
        right: false,
        interact: false,
        interactPressed: false,
      };
    }

    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(assets.player);
    sprite.width = PLAYER_SIZE;
    sprite.height = PLAYER_SIZE;
    sprite.anchor.set(0.5);
    container.addChild(sprite);
    Sprite[eid] = sprite;

    queueMicrotask(() => {
      const name = Player.name[eid];
      debug("player added: name=%s, eid=%s", name, eid);
    });
  });
};

const timeSystem = ({ world }: Context) => {
  const { time } = world;
  const now = performance.now();
  const delta = now - time.then;
  time.delta = delta;
  time.elapsed += delta;
  time.then = now;
};

const movementSystem = ({ world }: Context) => {
  const { Position, Velocity } = world.components;

  for (const eid of query(world, [Position, Velocity])) {
    const dx = Velocity.x[eid] * world.time.delta;
    const dy = Velocity.y[eid] * world.time.delta;
    Position.x[eid] += dx;
    Position.y[eid] += dy;
  }
};

const inputSystem = ({ world, input }: Context): void => {
  const { Player, Input } = world.components;
  const { keys } = input;
  const interactDown = keys[" "] || keys["space"] || false;
  const interactPressed = interactDown && !input.prevInteract;

  if (interactPressed) {
    debug("interact pressed!");
  }

  input.prevInteract = interactDown;

  for (const eid of query(world, [Player, Input])) {
    Input[eid] = {
      up: keys["w"] || keys["arrowup"] ? true : false,
      down: keys["s"] || keys["arrowdown"] ? true : false,
      left: keys["a"] || keys["arrowleft"] ? true : false,
      right: keys["d"] || keys["arrowright"] ? true : false,
      interact: interactDown ? true : false,
      interactPressed: interactPressed ? true : false,
    };
  }
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(t, 1);

const playerMovementSystem = ({ world }: Context): void => {
  const { Player, Input, Velocity } = world.components;
  const dt = world.time.delta;

  for (const eid of query(world, [Player, Input, Velocity])) {
    const input = Input[eid];

    let targetX = 0;
    let targetY = 0;

    if (input.left) targetX -= 1;
    if (input.right) targetX += 1;
    if (input.up) targetY -= 1;
    if (input.down) targetY += 1;

    if (targetX !== 0 && targetY !== 0) {
      const len = Math.sqrt(targetX * targetX + targetY * targetY);
      targetX /= len;
      targetY /= len;
    }

    targetX *= PLAYER_SPEED;
    targetY *= PLAYER_SPEED;

    const isMoving = targetX !== 0 || targetY !== 0;
    const blend = isMoving ? ACCELERATION : FRICTION;

    Velocity.x[eid] = lerp(Velocity.x[eid], targetX, blend * dt);
    Velocity.y[eid] = lerp(Velocity.y[eid], targetY, blend * dt);
  }
};

const spritesSystem = ({ world }: Context) => {
  const { Position, Sprite } = world.components;
  for (const eid of query(world, [Position, Sprite])) {
    const sprite = Sprite[eid];
    if (!sprite) continue;

    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
  }
};

const update = (context: Context) => {
  timeSystem(context);
  inputSystem(context);
  playerMovementSystem(context);
  movementSystem(context);
  spritesSystem(context);
};

const loadAssets = async () => {
  const player = await Assets.load<Texture>("/assets/sprites/player.png");

  return {
    player,
  };
};

const setupRenderer = async () => {
  const app = new Application();
  await app.init({ background: "#87CEEB", resizeTo: window });
  document.body.appendChild(app.canvas);

  const assets = await loadAssets();

  const container = new Container();
  app.stage.addChild(container);

  const context: Context = {
    world,
    app,
    container,
    assets,
    input: {
      keys: {},
      prevInteract: false,
    },
    me: {
      eid: null,
    },
  };

  setupPlayerObserver(context);

  window.context = context;

  window.addEventListener("keydown", (e) => {
    context.input.keys[e.key.toLowerCase()] = true;
  });

  window.addEventListener("keyup", (e) => {
    context.input.keys[e.key.toLowerCase()] = false;
  });

  app.ticker.add(() => {
    update(context);
  });

  return context;
};

const setupSocket = (context: Context) => {
  const { Player, Position, Velocity, Networked } = world.components;
  const networkedComponents = [Player, Position, Velocity];
  const snapshotDeserializer = createSnapshotDeserializer(
    world,
    networkedComponents,
  );
  const observerDeserializer = createObserverDeserializer(
    world,
    Networked,
    networkedComponents,
  );
  const soaDeserializer = createSoADeserializer(networkedComponents);

  const idMap = new Map();

  const socket = new WebSocket("ws://localhost:5001");
  socket.binaryType = "arraybuffer";

  socket.addEventListener("open", () => {
    console.log("connected to server");

    const UPDATE_RATE = 1000 / 15;

    let lastX: number | null = null;
    let lastY: number | null = null;

    setInterval(() => {
      const eid = context.me.eid;
      if (eid === null) return;

      const newX = Position.x[eid];
      const newY = Position.y[eid];

      let changed = false;

      if (lastX !== newX) {
        changed = true;
      }
      if (lastY !== newY) {
        changed = true;
      }

      if (changed) {
        debug("CHANGED!");
      }

      lastX = newX;
      lastY = newY;
    }, UPDATE_RATE);
  });

  socket.addEventListener("message", async (event) => {
    const messageView = new Uint8Array(event.data);
    const type = messageView[0];

    debug("handling message from server: %s", type);

    const payload = messageView.slice(1).buffer as ArrayBuffer;

    switch (type) {
      case MESSAGE_TYPES.SNAPSHOT:
        debug("received SNAPSHOT message");
        snapshotDeserializer(payload, idMap);
        break;
      case MESSAGE_TYPES.OBSERVER:
        debug("received OBSERVER message");
        observerDeserializer(payload, idMap);
        break;
      case MESSAGE_TYPES.SOA:
        debug("received SOA message");
        soaDeserializer(payload, idMap);
        break;
      case MESSAGE_TYPES.YOUR_EID:
        debug("received YOUR_EID message");
        // TODO should we map the eid to our eid? maybe these don't lineup?
        const view = new Int32Array(payload);
        const myEid = view[0];
        context.me.eid = myEid;
        break;
    }
  });

  socket.addEventListener("close", () => {
    console.log("disconnected from server");
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
};

const setup = async () => {
  const context = await setupRenderer();
  setupSocket(context);
};

setup();
