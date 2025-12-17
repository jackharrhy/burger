import "./style.css";

const showDebug = true;
const INTERP_DELAY = 50;

type PositionSnapshot = { x: number; y: number; time: number };

import debugFactory from "debug";
import {
  sharedComponents,
  MESSAGE_TYPES,
  networkedComponents,
} from "burger-shared";
import {
  Application,
  Assets,
  Container,
  Sprite as PixiSprite,
  Text as PixiText,
  Texture,
} from "pixi.js";
import { createWorld, query, addComponent, observe, onAdd } from "bitecs";
import {
  ACCELERATION,
  CLIENT_UPDATE_RATE,
  FRICTION,
  PLAYER_SIZE,
  PLAYER_SPEED,
} from "./consts";
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
    DebugText: [] as (PixiText | null)[],
    RenderPosition: { x: [] as number[], y: [] as number[] },
    PositionHistory: [] as PositionSnapshot[][],
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
  const {
    Player,
    Velocity,
    Sprite,
    Input,
    DebugText,
    RenderPosition,
    PositionHistory,
  } = world.components;

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

    addComponent(world, eid, Velocity);
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;

    addComponent(world, eid, RenderPosition);
    RenderPosition.x[eid] = 0;
    RenderPosition.y[eid] = 0;

    addComponent(world, eid, PositionHistory);
    PositionHistory[eid] = [];

    if (showDebug) {
      addComponent(world, eid, DebugText);
      const debugText = new PixiText({
        text: "",
        style: {
          fontFamily: "monospace",
          fontSize: 12,
          fill: 0x000000,
        },
      });
      debugText.anchor.set(0.5, 0);
      container.addChild(debugText);
      DebugText[eid] = debugText;
    }

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

const interpolationSystem = ({ world, me }: Context) => {
  const { Position, RenderPosition, PositionHistory } = world.components;
  const localEid = me.eid;
  const renderTime = performance.now() - INTERP_DELAY;

  for (const eid of query(world, [Position, RenderPosition, PositionHistory])) {
    if (eid === localEid) {
      RenderPosition.x[eid] = Position.x[eid];
      RenderPosition.y[eid] = Position.y[eid];
      continue;
    }

    const history = PositionHistory[eid];
    if (!history || history.length === 0) {
      RenderPosition.x[eid] = Position.x[eid];
      RenderPosition.y[eid] = Position.y[eid];
      continue;
    }

    const oldest = history[0];
    const newest = history[history.length - 1];

    /*
    if (renderTime <= oldest.time) {
      RenderPosition.x[eid] = oldest.x;
      RenderPosition.y[eid] = oldest.y;
      continue;
    }

    if (renderTime >= newest.time) {
      RenderPosition.x[eid] = newest.x;
      RenderPosition.y[eid] = newest.y;
      continue;
    }
    */

    let p1 = oldest;
    let p2 = newest;
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].time <= renderTime && history[i + 1].time >= renderTime) {
        p1 = history[i];
        p2 = history[i + 1];
        break;
      }
    }

    const duration = p2.time - p1.time;
    const t = duration > 0 ? (renderTime - p1.time) / duration : 0;
    RenderPosition.x[eid] = lerp(p1.x, p2.x, Math.max(0, Math.min(1, t)));
    RenderPosition.y[eid] = lerp(p1.y, p2.y, Math.max(0, Math.min(1, t)));
  }
};

const spritesSystem = ({ world }: Context) => {
  const { RenderPosition, Sprite } = world.components;
  for (const eid of query(world, [RenderPosition, Sprite])) {
    const sprite = Sprite[eid];
    if (!sprite) continue;

    sprite.x = RenderPosition.x[eid];
    sprite.y = RenderPosition.y[eid];
  }
};

const debugSystem = ({ world }: Context) => {
  if (!showDebug) return;

  const { RenderPosition, Velocity, DebugText } = world.components;
  for (const eid of query(world, [RenderPosition, Velocity, DebugText])) {
    const debugText = DebugText[eid];
    if (!debugText) continue;

    const px = RenderPosition.x[eid].toFixed(1);
    const py = RenderPosition.y[eid].toFixed(1);
    const vx = Velocity.x[eid].toFixed(2);
    const vy = Velocity.y[eid].toFixed(2);

    debugText.text = `pos: (${px}, ${py})\nvel: (${vx}, ${vy})`;
    debugText.x = RenderPosition.x[eid];
    debugText.y = RenderPosition.y[eid] + PLAYER_SIZE / 2 + 4;
  }
};

const update = (context: Context) => {
  timeSystem(context);
  inputSystem(context);
  playerMovementSystem(context);
  movementSystem(context);
  interpolationSystem(context);
  spritesSystem(context);
  debugSystem(context);
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
  const { Networked } = world.components;
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

    let lastX: number | null = null;
    let lastY: number | null = null;

    const { Position, Velocity } = world.components;
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
        const xVel = Velocity.x[eid];
        const yVel = Velocity.y[eid];

        socket.send(
          JSON.stringify({
            type: "position",
            x: Math.round(newX * 100) / 100,
            y: Math.round(newY * 100) / 100,
            xVel: Math.round(xVel * 100) / 100,
            yVel: Math.round(yVel * 100) / 100,
          }),
        );
      }

      lastX = newX;
      lastY = newY;
    }, CLIENT_UPDATE_RATE);
  });

  const { Position, Velocity } = world.components;
  socket.addEventListener("message", async (event) => {
    const messageView = new Uint8Array(event.data);
    const type = messageView[0];

    const payload = messageView.slice(1).buffer as ArrayBuffer;

    switch (type) {
      case MESSAGE_TYPES.SNAPSHOT:
        debug("received SNAPSHOT message");
        snapshotDeserializer(payload, idMap);
        break;
      case MESSAGE_TYPES.OBSERVER:
        observerDeserializer(payload, idMap);
        break;
      case MESSAGE_TYPES.SOA: {
        const { PositionHistory } = world.components;
        const localEid = context.me.eid;

        let savedX: number | undefined;
        let savedY: number | undefined;
        let savedXVel: number | undefined;
        let savedYVel: number | undefined;
        if (localEid !== null) {
          savedX = Position.x[localEid];
          savedY = Position.y[localEid];
          savedXVel = Velocity.x[localEid];
          savedYVel = Velocity.y[localEid];
        }

        soaDeserializer(payload, idMap);

        if (
          localEid !== null &&
          savedX !== undefined &&
          savedY !== undefined &&
          savedXVel !== undefined &&
          savedYVel !== undefined
        ) {
          Position.x[localEid] = savedX;
          Position.y[localEid] = savedY;
          Velocity.x[localEid] = savedXVel;
          Velocity.y[localEid] = savedYVel;
        }

        const now = performance.now();
        for (const eid of query(world, [Position, PositionHistory])) {
          if (eid === localEid) continue;
          const history = PositionHistory[eid];
          if (!history) continue;

          history.push({
            x: Position.x[eid],
            y: Position.y[eid],
            time: now,
          });

          while (history.length > 10) history.shift();
        }
        break;
      }
      case MESSAGE_TYPES.YOUR_EID:
        // TODO should we map the eid to our eid? maybe these don't lineup?
        const view = new Int32Array(payload);
        const myEid = view[0];
        context.me.eid = myEid;
        debug("received YOUR_EID message, we are: eid=%s", myEid);
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
