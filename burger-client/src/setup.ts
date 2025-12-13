import * as Pixi from "pixi.js";
import { FONTS_DIR, GRAVITY, SOUNDS_DIR, SPRITES_DIR } from "./vars";
import { Howl } from "howler";

export const pixi = new Pixi.Application();

await pixi.init({
  background: 0xffffff,
  resizeTo: window,
});

document.body.appendChild(pixi.canvas);

const RapierModule = await import("@dimforge/rapier2d-compat");
export const Rapier = RapierModule.default;
await Rapier.init();

export const world = new Rapier.World(GRAVITY);

await Pixi.Assets.load([
  { alias: "player", src: `${SPRITES_DIR}/player.png` },
  { alias: "red-brick", src: `${SPRITES_DIR}/red-brick.png` },
  { alias: "black-floor", src: `${SPRITES_DIR}/black-floor.png` },
  { alias: "debug", src: `${SPRITES_DIR}/debug.png` },
]);

const fontFace = new FontFace("ComicSans", `url(${FONTS_DIR}/ComicSansMS.ttf)`);
await fontFace.load();
document.fonts.add(fontFace);

const counterSound = new Howl({
  src: [`${SOUNDS_DIR}/Counter.mp3`],
  volume: 0.5,
});

export const sounds = {
  counter: counterSound,
};

export const worldContainer = new Pixi.Container();
export const levelContainer = new Pixi.Container();
export const playerContainer = new Pixi.Container();
export const debugContainer = new Pixi.Container();
pixi.stage.addChild(worldContainer);
worldContainer.addChild(levelContainer);
worldContainer.addChild(playerContainer);
worldContainer.addChild(debugContainer);

export const debugGraphics = new Pixi.Graphics();
worldContainer.addChild(debugGraphics);
