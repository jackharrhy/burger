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
  Rectangle,
  Texture,
  TextureSource,
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
import { GUI } from "lil-gui";

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
  typeIdToAtlasSrc: {} as Record<number, [number, number]>,
});

export type World = typeof world;

type Context = {
  world: World;
  app: Application;
  containers: {
    main: Container;
    tiles: Container;
    entities: Container;
    debug: Container;
  };
  assets: Awaited<ReturnType<typeof loadAssets>>;
  input: { keys: Record<string, boolean>; prevInteract: boolean };
  me: PlayerIdentity;
  network: NetworkState;
  camera: { x: number; y: number; initialized: boolean };
  metrics: {
    updatesHz: number;
    updatesCount: number;
    lastUpdateTime: number;
    lastBytesSent: number;
    lastBytesReceived: number;
    bytesSentPerSec: number;
    bytesReceivedPerSec: number;
    serverTicksCount: number;
    lastServerTickTime: number;
    serverTickrate: number;
  };
  debugMetrics: {
    updatesHz: number;
    tickrate: number;
    bytesSentPerSec: number;
    bytesReceivedPerSec: number;
    lag: number;
    jitter: number;
  };
  gui?: GUI;
};

declare global {
  interface Window {
    context: Context;
  }
}

const setupPlayerObserver = ({ world, assets, containers }: Context) => {
  const {
    Player,
    Sprite,
    DebugText,
    Velocity,
    RenderPosition,
    PositionHistory,
  } = world.components;

  observe(world, onAdd(Player), (eid) => {
    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(assets.player);
    sprite.width = PLAYER_SIZE;
    sprite.height = PLAYER_SIZE;
    sprite.anchor.set(0.5);
    containers.entities.addChild(sprite);
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
      containers.debug.addChild(debugText);
      DebugText[eid] = debugText;
    }

    debug("player added: eid=%s, name=%s", eid);
  });
};

const createTileSprites = ({ world, assets, containers }: Context) => {
  const { Tile, Position, Sprite } = world.components;

  for (const eid of query(world, [Tile, Position])) {
    if (Sprite[eid]) continue;

    const tileId = Tile.type[eid];

    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(assets.tiles[tileId]);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.anchor.set(0.5);
    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
    containers.tiles.addChild(sprite);
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

const networkSendSystem = ({ network, me, metrics }: Context) => {
  sendInputs(network, me.eid, metrics);
};

const metricsSystem = ({ network, metrics, debugMetrics }: Context) => {
  const now = performance.now();

  if (now - metrics.lastUpdateTime >= 1000) {
    const deltaTime = (now - metrics.lastUpdateTime) / 1000;
    metrics.updatesHz = metrics.updatesCount;
    metrics.updatesCount = 0;
    metrics.bytesSentPerSec =
      (network.bytesSent - metrics.lastBytesSent) / deltaTime;
    metrics.lastBytesSent = network.bytesSent;
    metrics.bytesReceivedPerSec =
      (network.bytesReceived - metrics.lastBytesReceived) / deltaTime;
    metrics.lastBytesReceived = network.bytesReceived;
    metrics.lastUpdateTime = now;
  }

  if (now - metrics.lastServerTickTime >= 1000) {
    metrics.serverTickrate = metrics.serverTicksCount;
    metrics.serverTicksCount = 0;
    metrics.lastServerTickTime = now;
  }

  debugMetrics.updatesHz = metrics.updatesHz;
  debugMetrics.tickrate = metrics.serverTickrate;
  debugMetrics.bytesSentPerSec = Math.round(metrics.bytesSentPerSec);
  debugMetrics.bytesReceivedPerSec = Math.round(metrics.bytesReceivedPerSec);
  network.lagMs = debugMetrics.lag;
  network.jitterMs = debugMetrics.jitter;
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

const cameraSystem = ({ world, app, containers, me, camera }: Context) => {
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

  containers.main.scale.set(ZOOM, ZOOM);
  containers.main.x = app.screen.width / 2 - camera.x * ZOOM;
  containers.main.y = app.screen.height / 2 - camera.y * ZOOM;
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

  const { Player, RenderPosition, Velocity, DebugText } = world.components;

  for (const eid of query(world, [RenderPosition, Velocity, DebugText])) {
    const debugText = DebugText[eid];
    if (!debugText) continue;

    const px = RenderPosition.x[eid].toFixed(1);
    const py = RenderPosition.y[eid].toFixed(1);
    const vx = Velocity.x[eid].toFixed(2);
    const vy = Velocity.y[eid].toFixed(2);

    let text = `pos: (${px}, ${py})\nvel: (${vx}, ${vy})`;

    const playerName = Player.name[eid];

    if (playerName) {
      text = `name: ${playerName}\n${text}`;
    }

    debugText.text = text;
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
  metricsSystem(context);
  debugSystem(context);
};

const loadAssets = async () => {
  const atlas = await Assets.load<TextureSource>("/assets/atlas.png");
  atlas.source.scaleMode = "nearest";
  const player = await Assets.load<Texture>("/assets/sprites/player.png");
  player.source.scaleMode = "nearest";

  const typeIdToAtlasSrc = await (await fetch("/api/atlas")).json();

  const tiles = Object.fromEntries(
    Object.entries(typeIdToAtlasSrc).map(([k, v]) => {
      const [x, y] = v as any;
      return [
        k,
        new Texture({
          source: atlas,
          frame: new Rectangle(x, y, TILE_SIZE, TILE_SIZE),
        }),
      ];
    }),
  );

  return { atlas, player, tiles };
};

const setupRenderer = async () => {
  const app = new Application();
  await app.init({
    background: "#87CEEB",
    resizeTo: window,
    roundPixels: true,
    antialias: false,
  });
  document.body.appendChild(app.canvas);

  const assets = await loadAssets();
  const mainContainer = new Container();
  const tilesContainer = new Container();
  const entitiesContainer = new Container();
  const debugContainer = new Container();

  app.stage.addChild(mainContainer);
  mainContainer.addChild(tilesContainer);
  mainContainer.addChild(entitiesContainer);
  mainContainer.addChild(debugContainer);

  const context: Context = {
    world,
    app,
    containers: {
      main: mainContainer,
      tiles: tilesContainer,
      entities: entitiesContainer,
      debug: debugContainer,
    },
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
      bytesSent: 0,
      bytesReceived: 0,
      lagMs: 0,
      jitterMs: 0,
    },
    camera: { x: 0, y: 0, initialized: false },
    metrics: {
      updatesHz: 0,
      updatesCount: 0,
      lastUpdateTime: 0,
      lastBytesSent: 0,
      lastBytesReceived: 0,
      bytesSentPerSec: 0,
      bytesReceivedPerSec: 0,
      serverTicksCount: 0,
      lastServerTickTime: 0,
      serverTickrate: 0,
    },
    debugMetrics: {
      updatesHz: 0,
      tickrate: 0,
      bytesSentPerSec: 0,
      bytesReceivedPerSec: 0,
      lag: 0,
      jitter: 0,
    },
  };

  setupPlayerObserver(context);
  window.context = context;

  if (showDebug) {
    const gui = new GUI();
    gui.add(context.debugMetrics, "updatesHz").name("Updates/sec").listen();
    gui
      .add(context.debugMetrics, "tickrate")
      .name("Server Tickrate (Hz)")
      .listen();
    gui
      .add(context.debugMetrics, "bytesSentPerSec")
      .name("Bytes Sent/sec")
      .listen();
    gui
      .add(context.debugMetrics, "bytesReceivedPerSec")
      .name("Bytes Received/sec")
      .listen();
    gui.add(context.debugMetrics, "lag", 0, 1000).name("Lag (ms)").listen();
    gui
      .add(context.debugMetrics, "jitter", 0, 500)
      .name("Jitter (ms)")
      .listen();
    gui.domElement.style.position = "absolute";
    gui.domElement.style.top = "10px";
    gui.domElement.style.right = "10px";
    context.gui = gui;
  }

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
    context,
  });
};

setup();
