/**
 * Radio Server - Streams audio to game clients via WebRTC
 *
 * Uses simple-peer with @roamhq/wrtc for Node.js WebRTC support.
 * Receives signaling via IPC from the game server.
 */

import SimplePeer from "simple-peer";
import wrtc from "@roamhq/wrtc";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import debugFactory from "debug";
import { sendResponse } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const debug = debugFactory("burger:radio");

type PlayerConnection = {
  peer: SimplePeer.Instance;
  playerEid: number;
};

type RadioState = {
  eid: number;
  audioSource: wrtc.nonstandard.RTCAudioSource | null;
  audioTrack: ReturnType<wrtc.nonstandard.RTCAudioSource["createTrack"]> | null;
  audioStream: wrtc.MediaStream | null;
  connections: Map<number, PlayerConnection>; // playerEid -> connection
  generating: boolean;
};

const radios = new Map<number, RadioState>();

export const startRadio = async (
  eid: number,
  audioFilePath?: string,
): Promise<void> => {
  if (radios.has(eid)) {
    debug("radio %s already running", eid);
    return;
  }

  const audioSource = new wrtc.nonstandard.RTCAudioSource();
  const audioTrack = audioSource.createTrack();
  const audioStream = new wrtc.MediaStream([audioTrack]);

  const state: RadioState = {
    eid,
    audioSource,
    audioTrack,
    audioStream,
    connections: new Map(),
    generating: true,
  };

  radios.set(eid, state);

  startAudioGeneration(state, audioFilePath);

  debug("radio %s started", eid);
};

export const handleSignal = (
  radioEid: number,
  playerEid: number,
  signal: unknown,
): void => {
  const state = radios.get(radioEid);
  if (!state) {
    debug("radio %s not found for signal", radioEid);
    return;
  }

  let connection = state.connections.get(playerEid);

  if (!connection) {
    debug("creating peer for player %s on radio %s", playerEid, radioEid);

    const peer = new SimplePeer({
      initiator: false,
      wrtc: wrtc as unknown as typeof globalThis,
      stream: state.audioStream as unknown as MediaStream,
    });

    peer.on("signal", (data) => {
      sendResponse({
        type: "signal",
        eid: radioEid,
        to: playerEid,
        signal: data,
      });
      debug("sent signal to player %s from radio %s", playerEid, radioEid);
    });

    peer.on("connect", () => {
      debug("player %s connected to radio %s", playerEid, radioEid);
    });

    peer.on("close", () => {
      debug("player %s disconnected from radio %s", playerEid, radioEid);
      state.connections.delete(playerEid);
    });

    peer.on("error", (err) => {
      console.error(
        `Radio ${radioEid} peer error for player ${playerEid}:`,
        err,
      );
      state.connections.delete(playerEid);
    });

    connection = { peer, playerEid };
    state.connections.set(playerEid, connection);
  }

  try {
    connection.peer.signal(signal as SimplePeer.SignalData);
    debug("passed signal to peer for player %s", playerEid);
  } catch (err) {
    console.error("Failed to signal peer:", err);
  }
};

const loadPcmFile = (filePath: string): Int16Array | null => {
  const resolvedPath = filePath.startsWith("/")
    ? filePath
    : resolve(__dirname, "..", filePath);

  if (!existsSync(resolvedPath)) {
    console.error(`Audio file not found: ${resolvedPath}`);
    return null;
  }

  try {
    const buffer = readFileSync(resolvedPath);
    const samples = new Int16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.length / 2,
    );
    debug(
      "loaded PCM file: %s (%d samples, %d seconds)",
      resolvedPath,
      samples.length,
      samples.length / 48000,
    );
    return samples;
  } catch (err) {
    console.error(`Failed to load audio file: ${resolvedPath}`, err);
    return null;
  }
};

const startAudioGeneration = (
  state: RadioState,
  audioFilePath?: string,
): void => {
  if (!state.audioSource) return;

  if (!audioFilePath) {
    debug("no audio file provided for radio %s", state.eid);
    return;
  }

  const pcmData = loadPcmFile(audioFilePath);
  if (!pcmData) {
    debug("failed to load audio file for radio %s", state.eid);
    return;
  }

  debug("streaming PCM file for radio %s: %s", state.eid, audioFilePath);

  const sampleRate = 48000;
  const channelCount = 1;
  const samplesPerFrame = 480; // 10ms at 48kHz

  let sampleIndex = 0;
  let lastFrameTime = performance.now();
  let accumulatedSamples = 0;

  const generateFrame = () => {
    if (!state.audioSource || !state.generating) return;

    const now = performance.now();
    const elapsedMs = now - lastFrameTime;
    lastFrameTime = now;

    accumulatedSamples += (elapsedMs / 1000) * sampleRate;

    while (accumulatedSamples >= samplesPerFrame) {
      const samples = new Int16Array(samplesPerFrame * channelCount);

      for (let i = 0; i < samplesPerFrame; i++) {
        const pcmIndex = (sampleIndex + i) % pcmData.length;
        samples[i] = pcmData[pcmIndex];
      }

      sampleIndex += samplesPerFrame;
      accumulatedSamples -= samplesPerFrame;

      if (sampleIndex >= pcmData.length) {
        sampleIndex = sampleIndex % pcmData.length;
      }

      state.audioSource.onData({
        samples,
        sampleRate,
        bitsPerSample: 16,
        channelCount,
        numberOfFrames: samplesPerFrame,
      });
    }

    if (state.generating) {
      setTimeout(generateFrame, 5);
    }
  };

  for (let i = 0; i < 3; i++) {
    accumulatedSamples += samplesPerFrame;
  }

  generateFrame();
  debug("audio generation started for radio %s", state.eid);
};

export const stopRadio = (eid: number): void => {
  const state = radios.get(eid);
  if (!state) return;

  state.generating = false;

  for (const connection of state.connections.values()) {
    try {
      connection.peer.destroy();
    } catch (e) {}
  }
  state.connections.clear();

  if (state.audioTrack) {
    state.audioTrack.stop();
  }

  radios.delete(eid);
  debug("radio %s stopped", eid);
};

export const stopAllRadios = (): void => {
  for (const eid of radios.keys()) {
    stopRadio(eid);
  }
};
