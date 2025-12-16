import { query } from "bitecs";
import { Howl } from "howler";
import { CookingTimer, UncookedPatty, Position } from "../components";
import type { GameWorld } from "../world";
import { getLocalPlayerEid } from "../../network/client";
import { TILE_SIZE, SOUNDS_DIR } from "../../vars";

const MAX_SOUND_RANGE = TILE_SIZE * 40;
const FADE_OUT_DURATION = 500;
const MIN_VOLUME_THRESHOLD = 0.05;
const MAX_VOLUME = 0.4;

const activeSounds = new Map<number, Howl>();
const fadingOutSounds = new Set<number>();

export const grillingSoundSystem = (world: GameWorld): void => {
  const localPlayerEid = getLocalPlayerEid();
  if (!localPlayerEid) return;

  const playerX = Position.x[localPlayerEid];
  const playerY = Position.y[localPlayerEid];

  const cookingPatties = query(world, [CookingTimer, UncookedPatty]);
  const currentCookingEids = new Set(cookingPatties);

  for (const eid of cookingPatties) {
    const pattyX = Position.x[eid];
    const pattyY = Position.y[eid];

    const dx = pattyX - playerX;
    const dy = pattyY - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const normalizedDistance = Math.min(distance / MAX_SOUND_RANGE, 1);
    const rawVolume = Math.pow(1 - normalizedDistance, 4) * MAX_VOLUME;
    const volume = rawVolume < MIN_VOLUME_THRESHOLD ? 0 : rawVolume;

    if (volume > 0) {
      let sound = activeSounds.get(eid);
      if (!sound) {
        sound = new Howl({
          src: [`${SOUNDS_DIR}/grilling-meat.mp3`],
          loop: true,
          volume: volume,
        });
        sound.play();
        activeSounds.set(eid, sound);
      } else if (!fadingOutSounds.has(eid)) {
        sound.volume(volume);
      }
    } else {
      const sound = activeSounds.get(eid);
      if (sound && !fadingOutSounds.has(eid)) {
        sound.stop();
        activeSounds.delete(eid);
      }
    }
  }

  for (const [eid, sound] of activeSounds) {
    if (!currentCookingEids.has(eid) && !fadingOutSounds.has(eid)) {
      fadingOutSounds.add(eid);
      const currentVolume = sound.volume();
      sound.fade(currentVolume, 0, FADE_OUT_DURATION);
      sound.once("fade", () => {
        sound.stop();
        activeSounds.delete(eid);
        fadingOutSounds.delete(eid);
      });
    }
  }
};
