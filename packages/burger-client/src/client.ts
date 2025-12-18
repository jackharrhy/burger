import "./style.css";

import {
  sharedComponents,
  PLAYER_SIZE,
  TILE_SIZE,
  applyInputToVelocity,
  moveAndSlide,
  lerp,
  type InputCmd,
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
  setupSocket,
  sendInputs,
  type PositionSnapshot,
  type NetworkState,
  type PlayerIdentity,
} from "./network.client";
import {
  CAMERA_LERP_FACTOR,
  DEADZONE_HEIGHT,
  DEADZONE_WIDTH,
  ERROR_DECAY_RATE,
  INTERP_DELAY,
  ZOOM,
} from "./consts.client";
import debugFactory from "debug";

const debug = debugFactory("burger:client");

const showDebug = true;

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

export type World = typeof world;

type Context = {
  world: World;
  app: Application;
  container: Container;
  assets: Awaited<ReturnType<typeof loadAssets>>;
  input: { keys: Record<string, boolean>; prevInteract: boolean };
  me: PlayerIdentity;
  network: NetworkState;
  camera: { x: number; y: number; initialized: boolean };
};

declare global {
  interface Window {
    context: Context;
  }
}

const setupPlayerObserver = ({ world, assets, container }: Context) => {
  const {
    Player,
    Velocity,
    Sprite,
    DebugText,
    RenderPosition,
    PositionHistory,
  } = world.components;

  observe(world, onAdd(Player), (eid) => {
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
        style: { fontFamily: "monospace", fontSize: 12, fill: 0x000000 },
      });
      debugText.anchor.set(0.5, 0);
      container.addChild(debugText);
      DebugText[eid] = debugText;
    }

    debug("player added: eid=%s, name=%s", eid);
  });
};

const createTileSprites = ({ world, assets, container }: Context) => {
  const { Tile, Solid, Position, Sprite } = world.components;

  for (const eid of query(world, [Tile, Solid, Position])) {
    if (Sprite[eid]) continue;

    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(assets.player);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.anchor.set(0.5);
    sprite.tint = 0x333333;
    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
    container.addChild(sprite);
    Sprite[eid] = sprite;
  }
};

const timeSystem = ({ world }: Context) => {
  const { time } = world;
  const now = performance.now();
  time.delta = now - time.then;
  time.elapsed += time.delta;
  time.then = now;
};

const inputSystem = ({ world, input }: Context): void => {
  const { Player, Input } = world.components;
  const { keys } = input;
  const interactDown = keys[" "] || keys["space"] || false;
  const interactPressed = interactDown && !input.prevInteract;
  input.prevInteract = interactDown;

  for (const eid of query(world, [Player, Input])) {
    Input[eid] = {
      up: keys["w"] || keys["arrowup"] || false,
      down: keys["s"] || keys["arrowdown"] || false,
      left: keys["a"] || keys["arrowleft"] || false,
      right: keys["d"] || keys["arrowright"] || false,
      interact: interactDown,
      interactPressed,
    };
  }
};

const predictionSystem = ({ world, me, network }: Context): void => {
  const { Input, Velocity, Position } = world.components;
  const dt = world.time.delta;

  if (me.eid === null) return;
  const eid = me.eid;
  const input = Input[eid];
  if (!input) return;

  const newVel = applyInputToVelocity(
    Velocity.x[eid],
    Velocity.y[eid],
    input,
    dt,
  );
  Velocity.x[eid] = newVel.vx;
  Velocity.y[eid] = newVel.vy;

  const newPos = moveAndSlide(
    world,
    Position.x[eid],
    Position.y[eid],
    Velocity.x[eid],
    Velocity.y[eid],
    dt,
  );
  Position.x[eid] = newPos.x;
  Position.y[eid] = newPos.y;

  const cmd: InputCmd = {
    seq: network.inputSeq++,
    msec: dt,
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
    interact: input.interact,
  };
  network.pendingInputs.push(cmd);

  if (network.pendingInputs.length > 128) {
    network.pendingInputs.shift();
  }
};

const networkSendSystem = ({ network, me }: Context) => {
  sendInputs(network, me.eid);
};

const errorDecaySystem = ({ network }: Context) => {
  const { predictionError } = network;
  predictionError.x *= 1 - ERROR_DECAY_RATE;
  predictionError.y *= 1 - ERROR_DECAY_RATE;
  if (Math.abs(predictionError.x) < 0.01) predictionError.x = 0;
  if (Math.abs(predictionError.y) < 0.01) predictionError.y = 0;
};

const interpolationSystem = ({ world, me, network }: Context) => {
  const { Position, Velocity, RenderPosition, PositionHistory } =
    world.components;
  const localEid = me.eid;
  const renderTime = performance.now() - INTERP_DELAY;

  for (const eid of query(world, [Position, RenderPosition, PositionHistory])) {
    if (eid === localEid) {
      RenderPosition.x[eid] = Position.x[eid] + network.predictionError.x;
      RenderPosition.y[eid] = Position.y[eid] + network.predictionError.y;
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

    if (renderTime >= newest.time) {
      const dt = renderTime - newest.time;
      RenderPosition.x[eid] = newest.x + Velocity.x[eid] * dt;
      RenderPosition.y[eid] = newest.y + Velocity.y[eid] * dt;
      continue;
    }

    if (renderTime <= oldest.time) {
      RenderPosition.x[eid] = oldest.x;
      RenderPosition.y[eid] = oldest.y;
      continue;
    }

    let p1 = oldest;
    let p2 = oldest;
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].time <= renderTime && history[i + 1].time >= renderTime) {
        p1 = history[i];
        p2 = history[i + 1];
        break;
      }
    }

    const duration = p2.time - p1.time;
    const t = duration > 0 ? (renderTime - p1.time) / duration : 0;
    RenderPosition.x[eid] = lerp(p1.x, p2.x, t);
    RenderPosition.y[eid] = lerp(p1.y, p2.y, t);
  }
};

const cameraSystem = ({ world, app, container, me, camera }: Context) => {
  if (me.eid === null) return;

  const { RenderPosition } = world.components;
  const px = RenderPosition.x[me.eid];
  const py = RenderPosition.y[me.eid];

  if (!camera.initialized) {
    camera.x = px;
    camera.y = py;
    camera.initialized = true;
  }

  let cameraTargetX = camera.x;
  let cameraTargetY = camera.y;

  if (px < camera.x - DEADZONE_WIDTH / 2) {
    cameraTargetX = px + DEADZONE_WIDTH / 2;
  } else if (px > camera.x + DEADZONE_WIDTH / 2) {
    cameraTargetX = px - DEADZONE_WIDTH / 2;
  }

  if (py < camera.y - DEADZONE_HEIGHT / 2) {
    cameraTargetY = py + DEADZONE_HEIGHT / 2;
  } else if (py > camera.y + DEADZONE_HEIGHT / 2) {
    cameraTargetY = py - DEADZONE_HEIGHT / 2;
  }

  camera.x = lerp(camera.x, cameraTargetX, CAMERA_LERP_FACTOR);
  camera.y = lerp(camera.y, cameraTargetY, CAMERA_LERP_FACTOR);

  container.scale.set(ZOOM, ZOOM);
  container.x = app.screen.width / 2 - camera.x * ZOOM;
  container.y = app.screen.height / 2 - camera.y * ZOOM;
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
  predictionSystem(context);
  networkSendSystem(context);
  errorDecaySystem(context);
  interpolationSystem(context);
  cameraSystem(context);
  spritesSystem(context);
  debugSystem(context);
};

const loadAssets = async () => {
  const player = await Assets.load<Texture>("/assets/sprites/player.png");
  return { player };
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
    input: { keys: {}, prevInteract: false },
    me: {
      eid: null,
      serverEid: null,
    },
    network: {
      socket: null,
      inputSeq: 0,
      lastSentSeq: -1,
      pendingInputs: [],
      predictionError: { x: 0, y: 0 },
      idMap: new Map(),
    },
    camera: { x: 0, y: 0, initialized: false },
  };

  setupPlayerObserver(context);
  window.context = context;

  window.addEventListener("keydown", (e) => {
    context.input.keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener("keyup", (e) => {
    context.input.keys[e.key.toLowerCase()] = false;
  });

  app.ticker.add(() => update(context));

  return context;
};

const setup = async () => {
  const context = await setupRenderer();

  setupSocket({
    world: context.world,
    network: context.network,
    me: context.me,
    onLocalPlayerReady: () => {
      if (context.me.eid !== null) {
        const { Input } = world.components;
        addComponent(world, context.me.eid, Input);
        Input[context.me.eid] = {
          up: false,
          down: false,
          left: false,
          right: false,
          interact: false,
          interactPressed: false,
        };
      }
    },
    onSnapshotReceived: () => {
      debug("snapshot received");
      createTileSprites(context);
    },
  });
};

setup();
