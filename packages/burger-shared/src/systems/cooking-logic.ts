import { CookingTimer } from "../components";

export const UNCOOKED_TINT = 0xffcccc;
export const COOKED_TINT = 0xd4a574;

export const lerpColor = (from: number, to: number, t: number): number => {
  const fromR = (from >> 16) & 0xff;
  const fromG = (from >> 8) & 0xff;
  const fromB = from & 0xff;

  const toR = (to >> 16) & 0xff;
  const toG = (to >> 8) & 0xff;
  const toB = to & 0xff;

  const r = Math.round(fromR + (toR - fromR) * t);
  const g = Math.round(fromG + (toG - fromG) * t);
  const b = Math.round(fromB + (toB - fromB) * t);

  return (r << 16) | (g << 8) | b;
};

export const getCookingProgress = (eid: number): number => {
  const elapsed = CookingTimer.elapsed[eid];
  const duration = CookingTimer.duration[eid];
  if (duration <= 0) return 0;
  return Math.min(elapsed / duration, 1);
};

export const isCookingComplete = (eid: number): boolean => {
  return CookingTimer.elapsed[eid] >= CookingTimer.duration[eid];
};

export const getCookingTint = (progress: number): number => {
  return lerpColor(UNCOOKED_TINT, COOKED_TINT, progress);
};

export const tickCookingTimer = (eid: number, deltaTime: number): boolean => {
  CookingTimer.elapsed[eid] += deltaTime;
  return isCookingComplete(eid);
};
