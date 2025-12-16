import * as Pixi from "pixi.js";
import { FONTS_DIR, GRAVITY, SOUNDS_DIR, SPRITES_DIR } from "./vars";
import { Howl } from "howler";

export const pixi = new Pixi.Application();

await pixi.init({
  roundPixels: true,
  antialias: false,
  background: 0x000000,
  resizeTo: window,
});

document.body.appendChild(pixi.canvas);

const RapierModule = await import("@dimforge/rapier2d-compat");
export const Rapier = RapierModule.default;
await Rapier.init();

export const world = new Rapier.World(GRAVITY);

const textureAssets = [
  { alias: "player", src: `${SPRITES_DIR}/player.png` },
  { alias: "red-brick", src: `${SPRITES_DIR}/red-brick.png` },
  { alias: "black-floor", src: `${SPRITES_DIR}/black-floor.png` },
  { alias: "stove", src: `${SPRITES_DIR}/stove.png` },
  { alias: "counter", src: `${SPRITES_DIR}/counter.png` },
  { alias: "uncooked-patty", src: `${SPRITES_DIR}/uncooked-patty.png` },
  { alias: "cooked-patty", src: `${SPRITES_DIR}/cooked-patty.png` },
  { alias: "debug", src: `${SPRITES_DIR}/debug.png` },
];

await Pixi.Assets.load(textureAssets);

for (const asset of textureAssets) {
  const texture = Pixi.Assets.get(asset.alias);
  if (texture?.source) {
    texture.source.scaleMode = "nearest";
  }
}

const fontFace = new FontFace("ComicSans", `url(${FONTS_DIR}/ComicSansMS.ttf)`);
await fontFace.load();
document.fonts.add(fontFace);

const counterSound = new Howl({
  src: [`${SOUNDS_DIR}/Counter.mp3`],
  volume: 0.5,
});

const grillingSound = new Howl({
  src: [`${SOUNDS_DIR}/grilling-meat.mp3`],
  loop: true,
  volume: 0,
});

export const sounds = {
  counter: counterSound,
  grilling: grillingSound,
};

export let showDebug = false;

export const worldContainer = new Pixi.Container();
export const levelContainer = new Pixi.Container();
export const entityContainer = new Pixi.Container();
export const playerContainer = new Pixi.Container();
export const debugContainer = new Pixi.Container();
debugContainer.visible = showDebug;

pixi.stage.addChild(worldContainer);
worldContainer.addChild(levelContainer);
worldContainer.addChild(entityContainer);
worldContainer.addChild(playerContainer);
worldContainer.addChild(debugContainer);

export const debugGraphics = new Pixi.Graphics();
worldContainer.addChild(debugGraphics);

export const toggleDebug = () => {
  showDebug = !showDebug;
  debugContainer.visible = showDebug;
  if (!showDebug) {
    debugGraphics.clear();
  }
  return showDebug;
};
