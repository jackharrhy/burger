import "./style.css";

import debugFactory from "debug";
import {
  Application,
  Assets,
  Container,
  Sprite as PixiSprite,
  Texture,
} from "pixi.js";
import { createWorld, query, addEntity, addComponent } from "bitecs";
import { ACCELERATION, FRICTION, PLAYER_SIZE, PLAYER_SPEED } from "./consts";

const debug = debugFactory("burger:main");

const world = createWorld({
  components: {
    Position: { x: [] as number[], y: [] as number[] },
    Velocity: { x: [] as number[], y: [] as number[] },
    Player: [] as { name: string }[],
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
};

declare global {
  interface Window {
    context: Context;
  }
}

const addPlayer = (
  { world, assets, container }: Context,
  { name }: { name: string },
) => {
  const { Position, Velocity, Player, Sprite, Input } = world.components;
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  Player[eid] = { name };

  addComponent(world, eid, Position);
  Position.x[eid] = 0;
  Position.y[eid] = 0;

  addComponent(world, eid, Velocity);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;

  addComponent(world, eid, Input);
  Input[eid] = {
    up: false,
    down: false,
    left: false,
    right: false,
    interact: false,
    interactPressed: false,
  };

  addComponent(world, eid, Sprite);
  const sprite = new PixiSprite(assets.player);
  sprite.width = PLAYER_SIZE;
  sprite.height = PLAYER_SIZE;
  sprite.anchor.set(0.5);
  container.addChild(sprite);
  Sprite[eid] = sprite;

  debug("adding player: name=%s, eid=%s", name, eid);
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
  };

  window.context = context;

  window.addEventListener("keydown", (e) => {
    context.input.keys[e.key.toLowerCase()] = true;
  });

  window.addEventListener("keyup", (e) => {
    context.input.keys[e.key.toLowerCase()] = false;
  });

  addPlayer(context, {
    name: "Harrhy",
  });

  app.ticker.add(() => {
    update(context);
  });
};

setupRenderer();
