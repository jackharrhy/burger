import type { PeerOptions } from "peerjs";

export const INTERP_HISTORY_MS = 200;
export const INTERP_DELAY = 75;
export const TELEPORT_THRESHOLD = 100;
export const ERROR_DECAY_RATE = 0.15;

export const ZOOM = 4;
export const DEADZONE_WIDTH = 100 / ZOOM;
export const DEADZONE_HEIGHT = DEADZONE_WIDTH;
export const CAMERA_LERP_FACTOR = 0.1;

export const VOICE_MAX_DISTANCE = 500;
export const VOICE_MIN_DISTANCE = 100;

const existingPort = Number(window.location.port);
const peerJsPort =
  existingPort ?? (window.location.protocol === "https:" ? 443 : 80);

export const PEERJS_CONFIG: PeerOptions = {
  host: window.location.hostname,
  path: "/peerjs",
  port: peerJsPort,
  secure: window.location.protocol === "https:",
};
