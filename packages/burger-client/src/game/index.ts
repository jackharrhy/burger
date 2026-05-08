import "../style.css";

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
import {
  createWorld,
  query,
  addComponent,
  observe,
  onAdd,
  onRemove,
} from "bitecs";
import {
  setupSocket,
  sendInputs,
  type PositionSnapshot,
  type NetworkState,
  type PlayerIdentity,
} from "./network";
import {
  CAMERA_LERP_FACTOR,
  DEADZONE_HEIGHT,
  DEADZONE_WIDTH,
  ERROR_DECAY_RATE,
  INTERP_DELAY,
  ZOOM,
} from "./consts";
import debugFactory from "debug";
import { GUI } from "lil-gui";
import type { Me } from "../types";
import {
  initEditor,
  updateEditor,
  type EditorState,
  type CatalogEntry,
} from "./editor";
import { useGameStore } from "../store";

const debug = debugFactory("burger:client");

const showDebug = import.meta.env.DEV;

const makeWorld = () =>
  createWorld({
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
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    typeIdToAtlasSrc: {} as Record<number, [number, number]>,
  });

export type World = ReturnType<typeof makeWorld>;

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
  user: Me;
  editor: EditorState | null;
};

declare global {
  interface Window {
    context: Context;
  }
}

const setupPlayerObserver = (context: Context) => {
  const { world, assets, containers } = context;
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

    debug("player added: eid=%s, name=%s", eid, Player.name[eid]);
  });

  observe(world, onRemove(Player), (eid) => {
    const sprite = Sprite[eid];
    if (sprite) {
      containers.entities.removeChild(sprite);
      sprite.destroy();
      delete Sprite[eid];
    }

    if (showDebug) {
      const debugText = DebugText[eid];
      if (debugText) {
        containers.debug.removeChild(debugText);
        debugText.destroy();
        delete DebugText[eid];
      }
    }

    delete Velocity.x[eid];
    delete Velocity.y[eid];
    delete RenderPosition.x[eid];
    delete RenderPosition.y[eid];
    PositionHistory[eid] = [];

    debug("player removed: eid=%s", eid);
  });
};

// Tile sprites are created/destroyed by polling each frame. We can't create
// sprites inside `onAdd(Tile)` because the bitecs snapshot deserializer adds
// components first and then replays the SoA payload — so Position.x/y aren't
// populated yet when onAdd(Tile) fires. Instead, the tileSpriteSystem below
// runs every frame, creates a sprite for any Tile entity that doesn't yet
// have one (Position is guaranteed by then), and destroys orphaned sprites
// when entities are removed.
const tileSpriteSystem = ({ world, assets, containers }: Context) => {
  const { Tile, Position, Sprite } = world.components;

  // Add sprites for new tile entities.
  for (const eid of query(world, [Tile, Position])) {
    if (Sprite[eid]) continue;
    const tileId = Tile.type[eid]!;
    const texture = assets.tiles[tileId];
    if (!texture) {
      console.warn(`Missing tile texture for tileId=${tileId}`);
      continue;
    }

    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(texture);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.anchor.set(0.5);
    sprite.x = Position.x[eid]!;
    sprite.y = Position.y[eid]!;
    containers.tiles.addChild(sprite);
    Sprite[eid] = sprite;
  }
};

// Destroy sprites for entities removed via the OBSERVER stream. Hook on
// onRemove(Tile) so erase paints are reflected immediately on screen.
const setupTileObserver = (context: Context) => {
  const { world, containers } = context;
  const { Tile, Sprite } = world.components;

  observe(world, onRemove(Tile), (eid) => {
    const sprite = Sprite[eid];
    if (sprite) {
      containers.tiles.removeChild(sprite);
      sprite.destroy();
      delete Sprite[eid];
    }
  });
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
    Velocity.x[eid]!,
    Velocity.y[eid]!,
    input,
    dt,
  );
  Velocity.x[eid] = newVel.vx;
  Velocity.y[eid] = newVel.vy;

  const newPos = moveAndSlide(
    world,
    Position.x[eid]!,
    Position.y[eid]!,
    Velocity.x[eid]!,
    Velocity.y[eid]!,
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

  // Mirror to the React store so the chrome can render these.
  useGameStore.getState().setMetrics({
    tickrate: debugMetrics.tickrate,
    lag: debugMetrics.lag,
    updatesHz: debugMetrics.updatesHz,
    bytesSentPerSec: debugMetrics.bytesSentPerSec,
    bytesReceivedPerSec: debugMetrics.bytesReceivedPerSec,
  });
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
      RenderPosition.x[eid] = Position.x[eid]! + network.predictionError.x;
      RenderPosition.y[eid] = Position.y[eid]! + network.predictionError.y;
      continue;
    }

    const history = PositionHistory[eid];
    if (!history || history.length === 0) {
      RenderPosition.x[eid] = Position.x[eid]!;
      RenderPosition.y[eid] = Position.y[eid]!;
      continue;
    }

    const oldest = history[0]!;
    const newest = history[history.length - 1]!;

    if (renderTime >= newest.time) {
      const dt = renderTime - newest.time;
      RenderPosition.x[eid] = newest.x + Velocity.x[eid]! * dt;
      RenderPosition.y[eid] = newest.y + Velocity.y[eid]! * dt;
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
      const a = history[i]!;
      const b = history[i + 1]!;
      if (a.time <= renderTime && b.time >= renderTime) {
        p1 = a;
        p2 = b;
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
  const px = RenderPosition.x[me.eid]!;
  const py = RenderPosition.y[me.eid]!;

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
    sprite.x = RenderPosition.x[eid]!;
    sprite.y = RenderPosition.y[eid]!;
  }
};

const debugSystem = ({ world }: Context) => {
  if (!showDebug) return;

  const { Player, RenderPosition, Velocity, DebugText } = world.components;

  for (const eid of query(world, [RenderPosition, Velocity, DebugText])) {
    const debugText = DebugText[eid];
    if (!debugText) continue;

    const px = (RenderPosition.x[eid] ?? 0).toFixed(1);
    const py = (RenderPosition.y[eid] ?? 0).toFixed(1);
    const vx = (Velocity.x[eid] ?? 0).toFixed(2);
    const vy = (Velocity.y[eid] ?? 0).toFixed(2);

    let text = `pos: (${px}, ${py})\nvel: (${vx}, ${vy})`;

    const playerName = Player.name[eid];

    if (playerName) {
      text = `name: ${playerName}\n${text}`;
    }

    debugText.text = text;
    debugText.x = RenderPosition.x[eid]!;
    debugText.y = RenderPosition.y[eid]! + PLAYER_SIZE / 2 + 4;
  }
};

const editorSystem = (context: Context) => {
  if (!context.editor) return;
  updateEditor(context.editor, context.assets.tiles);
};

const update = (context: Context) => {
  timeSystem(context);
  inputSystem(context);
  predictionSystem(context);
  networkSendSystem(context);
  errorDecaySystem(context);
  interpolationSystem(context);
  cameraSystem(context);
  tileSpriteSystem(context);
  spritesSystem(context);
  metricsSystem(context);
  debugSystem(context);
  editorSystem(context);
};

const loadAssets = async () => {
  const atlas = await Assets.load<TextureSource>("/assets/atlas.png");
  atlas.source.scaleMode = "nearest";
  const player = await Assets.load<Texture>("/assets/sprites/player.png");
  player.source.scaleMode = "nearest";

  const catalog = (await (
    await fetch("/api/catalog")
  ).json()) as CatalogEntry[];
  const tiles: Record<number, Texture> = {};
  for (const entry of catalog) {
    tiles[entry.id] = new Texture({
      source: atlas,
      frame: new Rectangle(entry.src_x, entry.src_y, TILE_SIZE, TILE_SIZE),
    });
  }

  return { atlas, player, tiles, catalog };
};

/**
 * Boot the game. Returns a cleanup function that fully tears down Pixi,
 * the WebSocket, the ticker, and any global event listeners. Safe to call
 * multiple times (each invocation is fully independent).
 */
export const startGame = (parent: HTMLElement, user: Me): (() => void) => {
  const world = makeWorld();

  const app = new Application();
  let isRunning = true;
  const teardownCallbacks: Array<() => void> = [];

  useGameStore.getState().setUser(user);
  teardownCallbacks.push(() => {
    useGameStore.getState().setUser(null);
    useGameStore.getState().setEditor(null);
  });

  void (async () => {
    await app.init({
      background: "#87CEEB",
      resizeTo: window,
      roundPixels: true,
      antialias: false,
    });

    if (!isRunning) {
      // unmounted before init completed
      app.destroy(true);
      return;
    }

    parent.appendChild(app.canvas);
    teardownCallbacks.push(() => {
      if (app.canvas.parentElement === parent) {
        parent.removeChild(app.canvas);
      }
    });

    const assets = await loadAssets();
    if (!isRunning) {
      // Cleanup fired during loadAssets. The canvas teardown is already
      // queued; let the outer cleanup loop drain it. Don't continue
      // building things the cleanup can't see.
      return;
    }

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
        onCatalogUpdated: (catalog) => {
          context.assets.catalog = catalog as typeof context.assets.catalog;
          const newTiles: typeof context.assets.tiles = {};
          for (const e of catalog) {
            newTiles[e.id] = new Texture({
              source: context.assets.atlas,
              frame: new Rectangle(e.src_x, e.src_y, TILE_SIZE, TILE_SIZE),
            });
          }
          context.assets.tiles = newTiles;
          debug("catalog updated locally: %d entries", catalog.length);
        },
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
      user,
      editor: null,
    };

    setupPlayerObserver(context);
    setupTileObserver(context);

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

      const accountFolder = gui.addFolder("Account");
      const accountInfo = { name: user.displayName ?? user.username };
      accountFolder.add(accountInfo, "name").name("Signed in as").disable();
      accountFolder
        .add(
          {
            signOut: async () => {
              await fetch("/auth/logout", { method: "POST" });
              window.location.href = "/login";
            },
          },
          "signOut",
        )
        .name("Sign out");

      gui.domElement.style.position = "absolute";
      gui.domElement.style.top = "10px";
      gui.domElement.style.right = "10px";
      context.gui = gui;
      teardownCallbacks.push(() => gui.destroy());
    }

    const onKeyDown = (e: KeyboardEvent) => {
      context.input.keys[e.key.toLowerCase()] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      context.input.keys[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    teardownCallbacks.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });

    const tickFn = () => update(context);
    app.ticker.add(tickFn);
    teardownCallbacks.push(() => app.ticker.remove(tickFn));

    setupSocket({
      world,
      network: context.network,
      me: context.me,
      onLocalPlayerReady: async () => {
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

        if (context.user.isAdmin) {
          context.editor = initEditor(
            context.app,
            context.assets.catalog,
            context.assets.tiles,
            context.network,
            context.containers.main,
            () => context.camera,
            () => ZOOM,
          );
          useGameStore.getState().setEditor({
            active: false,
            selectedTileId: context.editor.selectedTileId,
          });
        }
      },
      onSnapshotReceived: () => {
        debug("snapshot received");
        // Tile sprites are created/destroyed by setupTileObserver — onAdd(Tile)
        // fires for both the initial snapshot and live OBSERVER deltas.
      },
      onSocketClose: () => debug("socket closed"),
      context,
    });
    teardownCallbacks.push(() => {
      if (context.network.socket) {
        context.network.socket.close();
      }
    });

    // expose for debugging from the devtools console
    (window as { context?: Context }).context = context;
  })();

  return () => {
    isRunning = false;
    while (teardownCallbacks.length > 0) {
      const fn = teardownCallbacks.pop();
      try {
        fn?.();
      } catch (e) {
        console.error("teardown failed", e);
      }
    }
    try {
      app.destroy(true);
    } catch {
      // already destroyed
    }
  };
};
