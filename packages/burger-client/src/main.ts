import "./style.css";

import debugFactory from "debug";
import {
  sharedComponents,
  MESSAGE_TYPES,
  networkedComponents,
  PLAYER_SIZE,
  applyInputToVelocity,
  applyVelocityToPosition,
  lerp,
  type InputCmd,
  type GameStateMessage,
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
  createObserverDeserializer,
  createSnapshotDeserializer,
} from "bitecs/serialization";
import { CLIENT_UPDATE_RATE } from "./consts";

const debug = debugFactory("burger:client");

// =============================================================================
// Configuration
// =============================================================================

const showDebug = true;
const INTERP_DELAY = 75; // ms to delay rendering for smooth interpolation
const INTERP_HISTORY_MS = 200; // ms of history to keep for interpolation
const TELEPORT_THRESHOLD = 100; // pixels - snap if error exceeds this
const ERROR_DECAY_RATE = 0.15; // how fast to blend out prediction errors

// =============================================================================
// Types
// =============================================================================

type PositionSnapshot = { x: number; y: number; time: number };

// =============================================================================
// World Setup
// =============================================================================

const world = createWorld({
  components: {
    ...sharedComponents,
    // Client-only components
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
    prevInteract: boolean;
  };
  me: {
    eid: number | null; // Client-side EID (after mapping)
    serverEid: number | null; // Server-side EID (before mapping)
  };
  network: {
    socket: WebSocket | null;
    inputSeq: number;
    lastSentSeq: number; // Track which inputs have been sent
    pendingInputs: InputCmd[];
    predictionError: { x: number; y: number }; // For smoothing
    idMap: Map<number, number>; // Server EID -> Client EID
  };
};

declare global {
  interface Window {
    context: Context;
  }
}

// =============================================================================
// Player Observer (handles entity creation)
// =============================================================================

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
    // Note: We don't know if this is the local player yet during SNAPSHOT
    // deserialization. Input component is added separately after we know our EID.

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

// Set up input for the local player (called after we know our EID)
const setupLocalPlayerInput = (context: Context) => {
  const { Input } = context.world.components;
  const eid = context.me.eid;

  if (eid === null) return;

  debug("setting up input for our own player, eid=%d", eid);
  addComponent(context.world, eid, Input);
  Input[eid] = {
    up: false,
    down: false,
    left: false,
    right: false,
    interact: false,
    interactPressed: false,
  };
};

// =============================================================================
// Systems
// =============================================================================

const timeSystem = ({ world }: Context) => {
  const { time } = world;
  const now = performance.now();
  const delta = now - time.then;
  time.delta = delta;
  time.elapsed += delta;
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
      interactPressed: interactPressed,
    };
  }
};

// Client-side prediction: apply input locally for immediate feedback
const predictionSystem = ({ world, me, network }: Context): void => {
  const { Input, Velocity, Position } = world.components;
  const dt = world.time.delta;

  if (me.eid === null) return;

  const eid = me.eid;
  const input = Input[eid];
  if (!input) return;

  // Apply input to velocity (same logic as server)
  const newVel = applyInputToVelocity(
    Velocity.x[eid],
    Velocity.y[eid],
    input,
    dt,
  );
  Velocity.x[eid] = newVel.vx;
  Velocity.y[eid] = newVel.vy;

  // Apply velocity to position
  const newPos = applyVelocityToPosition(
    Position.x[eid],
    Position.y[eid],
    Velocity.x[eid],
    Velocity.y[eid],
    dt,
  );
  Position.x[eid] = newPos.x;
  Position.y[eid] = newPos.y;

  // Store input for reconciliation (will be sent by networkSendSystem)
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

  // Limit pending inputs buffer
  if (network.pendingInputs.length > 128) {
    network.pendingInputs.shift();
  }
};

// Send ALL unsent inputs to server at fixed rate
const networkSendSystem = (() => {
  let lastSendTime = 0;

  return ({ network, me }: Context) => {
    const now = performance.now();
    if (now - lastSendTime < CLIENT_UPDATE_RATE) return;
    lastSendTime = now;

    const { socket, pendingInputs, lastSentSeq } = network;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (me.eid === null) return;

    // Find all inputs that haven't been sent yet
    const unsentInputs = pendingInputs.filter((cmd) => cmd.seq > lastSentSeq);

    if (unsentInputs.length === 0) return;

    // Send ALL unsent inputs
    for (const cmd of unsentInputs) {
      socket.send(
        JSON.stringify({
          type: "input",
          ...cmd,
        }),
      );
    }

    // Update lastSentSeq to the highest sent
    network.lastSentSeq = unsentInputs[unsentInputs.length - 1].seq;

    debug(
      "SEND: sent %d inputs (seq %d-%d), pending=%d",
      unsentInputs.length,
      unsentInputs[0].seq,
      unsentInputs[unsentInputs.length - 1].seq,
      pendingInputs.length,
    );
  };
})();

// Decay prediction error over time for smooth correction
const errorDecaySystem = ({ network }: Context) => {
  const { predictionError } = network;

  predictionError.x *= 1 - ERROR_DECAY_RATE;
  predictionError.y *= 1 - ERROR_DECAY_RATE;

  // Zero out tiny errors
  if (Math.abs(predictionError.x) < 0.01) predictionError.x = 0;
  if (Math.abs(predictionError.y) < 0.01) predictionError.y = 0;
};

// Interpolate remote players, apply error offset to local player
const interpolationSystem = ({ world, me, network }: Context) => {
  const { Position, Velocity, RenderPosition, PositionHistory } = world.components;
  const localEid = me.eid;
  const renderTime = performance.now() - INTERP_DELAY;

  for (const eid of query(world, [Position, RenderPosition, PositionHistory])) {
    // Local player uses predicted position + error offset
    if (eid === localEid) {
      RenderPosition.x[eid] = Position.x[eid] + network.predictionError.x;
      RenderPosition.y[eid] = Position.y[eid] + network.predictionError.y;
      continue;
    }

    // Remote players use interpolation (with extrapolation fallback)
    const history = PositionHistory[eid];
    if (!history || history.length === 0) {
      RenderPosition.x[eid] = Position.x[eid];
      RenderPosition.y[eid] = Position.y[eid];
      continue;
    }

    const oldest = history[0];
    const newest = history[history.length - 1];

    // If renderTime is past our newest snapshot, extrapolate using velocity
    if (renderTime >= newest.time) {
      const timeSinceNewest = renderTime - newest.time;
      RenderPosition.x[eid] = newest.x + Velocity.x[eid] * timeSinceNewest;
      RenderPosition.y[eid] = newest.y + Velocity.y[eid] * timeSinceNewest;
      continue;
    }

    // If renderTime is before our oldest snapshot, just show oldest
    if (renderTime <= oldest.time) {
      RenderPosition.x[eid] = oldest.x;
      RenderPosition.y[eid] = oldest.y;
      continue;
    }

    // Find the two snapshots to interpolate between
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

const spritesSystem = ({ world }: Context) => {
  const { RenderPosition, Sprite } = world.components;
  for (const eid of query(world, [RenderPosition, Sprite])) {
    const sprite = Sprite[eid];
    if (!sprite) continue;

    sprite.x = RenderPosition.x[eid];
    sprite.y = RenderPosition.y[eid];
  }
};

const debugSystem = ({ world, network }: Context) => {
  if (!showDebug) return;

  const { RenderPosition, Velocity, DebugText } = world.components;
  const { predictionError, pendingInputs } = network;

  for (const eid of query(world, [RenderPosition, Velocity, DebugText])) {
    const debugText = DebugText[eid];
    if (!debugText) continue;

    const px = RenderPosition.x[eid].toFixed(1);
    const py = RenderPosition.y[eid].toFixed(1);
    const vx = Velocity.x[eid].toFixed(2);
    const vy = Velocity.y[eid].toFixed(2);
    const pending = pendingInputs.length;
    const errX = predictionError.x.toFixed(1);
    const errY = predictionError.y.toFixed(1);

    debugText.text = `pos: (${px}, ${py})\nvel: (${vx}, ${vy})\npending: ${pending}\nerr: (${errX}, ${errY})`;
    debugText.x = RenderPosition.x[eid];
    debugText.y = RenderPosition.y[eid] + PLAYER_SIZE / 2 + 4;
  }
};

// =============================================================================
// Main Update Loop
// =============================================================================

const update = (context: Context) => {
  timeSystem(context);
  inputSystem(context);
  predictionSystem(context);
  networkSendSystem(context);
  errorDecaySystem(context);
  interpolationSystem(context);
  spritesSystem(context);
  debugSystem(context);
};

// =============================================================================
// Asset Loading
// =============================================================================

const loadAssets = async () => {
  const player = await Assets.load<Texture>("/assets/sprites/player.png");
  return { player };
};

// =============================================================================
// Renderer Setup
// =============================================================================

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

// =============================================================================
// Reconciliation
// =============================================================================

const reconcile = (context: Context, serverState: GameStateMessage) => {
  const { Position, Velocity, PositionHistory } = context.world.components;
  const { idMap } = context.network;
  const localClientEid = context.me.eid;
  const localServerEid = context.me.serverEid;

  // Update all players from server state
  for (const playerState of serverState.players) {
    const serverEid = playerState.eid;

    // Map server EID to client EID
    const eid = idMap.get(serverEid);
    if (eid === undefined) {
      // Entity not yet created on client, skip
      continue;
    }

    const isLocalPlayer = serverEid === localServerEid;

    if (isLocalPlayer && localClientEid !== null) {
      // This is us - reconcile with server
      const { pendingInputs, predictionError } = context.network;

      // Remember current predicted position before reconciliation
      const predictedX = Position.x[eid];
      const predictedY = Position.y[eid];

      debug(
        "RECONCILE: server pos=(%.1f, %.1f) vel=(%.2f, %.2f) ackSeq=%d",
        playerState.x,
        playerState.y,
        playerState.vx,
        playerState.vy,
        playerState.lastInputSeq,
      );
      debug(
        "RECONCILE: before - pending=%d, firstSeq=%d, lastSeq=%d",
        pendingInputs.length,
        pendingInputs[0]?.seq ?? -1,
        pendingInputs[pendingInputs.length - 1]?.seq ?? -1,
      );

      // Remove all inputs that the server has acknowledged
      while (
        pendingInputs.length > 0 &&
        pendingInputs[0].seq <= playerState.lastInputSeq
      ) {
        pendingInputs.shift();
      }

      debug(
        "RECONCILE: after ack removal - pending=%d",
        pendingInputs.length,
      );

      // Start from server position
      Position.x[eid] = playerState.x;
      Position.y[eid] = playerState.y;
      Velocity.x[eid] = playerState.vx;
      Velocity.y[eid] = playerState.vy;

      // Re-apply all unacknowledged inputs (prediction replay)
      for (const cmd of pendingInputs) {
        const newVel = applyInputToVelocity(
          Velocity.x[eid],
          Velocity.y[eid],
          cmd,
          cmd.msec,
        );
        Velocity.x[eid] = newVel.vx;
        Velocity.y[eid] = newVel.vy;

        const newPos = applyVelocityToPosition(
          Position.x[eid],
          Position.y[eid],
          Velocity.x[eid],
          Velocity.y[eid],
          cmd.msec,
        );
        Position.x[eid] = newPos.x;
        Position.y[eid] = newPos.y;
      }

      // Calculate prediction error (difference between old prediction and new)
      const errorX = predictedX - Position.x[eid];
      const errorY = predictedY - Position.y[eid];
      const errorLen = Math.abs(errorX) + Math.abs(errorY);

      debug(
        "RECONCILE: final pos=(%.1f, %.1f), error=(%.1f, %.1f) len=%.1f",
        Position.x[eid],
        Position.y[eid],
        errorX,
        errorY,
        errorLen,
      );

      if (errorLen > TELEPORT_THRESHOLD) {
        // Large error = teleport, snap instantly (no smoothing)
        predictionError.x = 0;
        predictionError.y = 0;
        debug("RECONCILE: TELEPORT - error too large, snapping");
      } else {
        // Small error = smooth it out over time
        predictionError.x = errorX;
        predictionError.y = errorY;
      }
    } else {
      // Remote player - update their position for interpolation
      Position.x[eid] = playerState.x;
      Position.y[eid] = playerState.y;
      Velocity.x[eid] = playerState.vx;
      Velocity.y[eid] = playerState.vy;

      // Add to history for interpolation
      const history = PositionHistory[eid];
      if (history) {
        const now = performance.now();
        history.push({
          x: playerState.x,
          y: playerState.y,
          time: now,
        });

        // Prune old history (keep ~200ms worth, but always at least 2 entries)
        const cutoffTime = now - INTERP_HISTORY_MS;
        while (history.length > 2 && history[0].time < cutoffTime) {
          history.shift();
        }
      }
    }
  }
};

// =============================================================================
// Network Setup
// =============================================================================

const setupSocket = (context: Context) => {
  const { Networked } = world.components;
  const { idMap } = context.network;

  const snapshotDeserializer = createSnapshotDeserializer(
    world,
    networkedComponents,
  );
  const observerDeserializer = createObserverDeserializer(
    world,
    Networked,
    networkedComponents,
  );

  const socket = new WebSocket("ws://localhost:5001");
  socket.binaryType = "arraybuffer";
  context.network.socket = socket;

  socket.addEventListener("open", () => {
    console.log("connected to server");
  });

  socket.addEventListener("message", async (event) => {
    const messageView = new Uint8Array(event.data);
    const type = messageView[0];
    const payload = messageView.slice(1).buffer as ArrayBuffer;

    switch (type) {
      case MESSAGE_TYPES.SNAPSHOT:
        debug("received SNAPSHOT message");
        snapshotDeserializer(payload, idMap);
        // Now that snapshot is processed, we can map our server EID to client EID
        if (context.me.serverEid !== null && context.me.eid === null) {
          const clientEid = idMap.get(context.me.serverEid);
          if (clientEid !== undefined) {
            context.me.eid = clientEid;
            debug("mapped our server eid %d -> client eid %d", context.me.serverEid, clientEid);
            setupLocalPlayerInput(context);
          }
        }
        break;

      case MESSAGE_TYPES.OBSERVER:
        debug("received OBSERVER message");
        observerDeserializer(payload, idMap);
        // Also check if our EID mapping is now available (in case of late join)
        if (context.me.serverEid !== null && context.me.eid === null) {
          const clientEid = idMap.get(context.me.serverEid);
          if (clientEid !== undefined) {
            context.me.eid = clientEid;
            debug("mapped our server eid %d -> client eid %d", context.me.serverEid, clientEid);
            setupLocalPlayerInput(context);
          }
        }
        break;

      case MESSAGE_TYPES.GAME_STATE: {
        const decoder = new TextDecoder();
        const json = decoder.decode(payload);
        const gameState: GameStateMessage = JSON.parse(json);
        reconcile(context, gameState);
        break;
      }

      case MESSAGE_TYPES.YOUR_EID: {
        const view = new Int32Array(payload);
        const serverEid = view[0];
        context.me.serverEid = serverEid;
        debug("received YOUR_EID message, server eid=%d", serverEid);
        // Client EID will be set after SNAPSHOT is processed
        break;
      }
    }
  });

  socket.addEventListener("close", () => {
    console.log("disconnected from server");
    context.network.socket = null;
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
};

// =============================================================================
// Entry Point
// =============================================================================

const setup = async () => {
  const context = await setupRenderer();
  setupSocket(context);
};

setup();
