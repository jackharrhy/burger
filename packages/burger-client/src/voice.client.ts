/**
 * Proximity Voice Chat using simple-peer
 *
 * Uses WebRTC peer-to-peer connections for audio via simple-peer,
 * with Web Audio API GainNodes for distance-based volume control.
 * Signaling is done through the game WebSocket.
 *
 * AudioEmitter component provides the peerId:
 * - Positive peerId: bidirectional audio (players send + receive)
 * - Negative peerId: receive-only audio (radios only broadcast)
 */

import SimplePeer from "simple-peer";
import { VOICE_MAX_DISTANCE, VOICE_MIN_DISTANCE } from "./consts.client";
import { sendSignal, type NetworkState } from "./network.client";
import type { SignalMessage } from "burger-shared";
import debugFactory from "debug";

const debug = debugFactory("burger:voice");

type AudioConnection = {
  peerId: number;
  peer: SimplePeer.Instance;
  gainNode: GainNode;
  sourceNode: MediaStreamAudioSourceNode | null;
  audioElement: HTMLAudioElement | null;
};

export type VoiceState = {
  network: NetworkState;
  audioContext: AudioContext | null;
  localStream: MediaStream | null;
  connections: Map<number, AudioConnection>; // key: peerId
  muted: boolean;
  myPeerId: number;
  vadEnabled: boolean;
  vadThreshold: number;
  analyserNode: AnalyserNode | null;
  vadActive: boolean;
};

export const initVoice = async (
  myPeerId: number,
  network: NetworkState,
  onReady?: () => void
): Promise<VoiceState> => {
  const state: VoiceState = {
    network,
    audioContext: null,
    localStream: null,
    connections: new Map(),
    muted: false,
    myPeerId,
    vadEnabled: false,
    vadThreshold: 0.02,
    analyserNode: null,
    vadActive: true,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    state.localStream = stream;
    debug("microphone access granted");

    state.audioContext = new AudioContext();

    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
      debug("AudioContext resumed");
    }

    const analyserNode = state.audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    const analyserTrack = stream.getAudioTracks()[0].clone();
    const analyserStream = new MediaStream([analyserTrack]);
    const micSource =
      state.audioContext.createMediaStreamSource(analyserStream);
    micSource.connect(analyserNode);
    const silentGain = state.audioContext.createGain();
    silentGain.gain.value = 0;
    analyserNode.connect(silentGain);
    silentGain.connect(state.audioContext.destination);
    state.analyserNode = analyserNode;

    startVadLoop(state);

    network.onSignal = (signal: SignalMessage) => {
      handleIncomingSignal(state, signal);
    };

    debug("voice initialized for peerId %s", myPeerId);

    if (onReady) {
      onReady();
    }

    return state;
  } catch (err) {
    console.error("Failed to initialize voice chat:", err);
    return state;
  }
};

const handleIncomingSignal = (
  state: VoiceState,
  signal: SignalMessage
): void => {
  const fromPeerId = signal.from;
  let connection = state.connections.get(fromPeerId);

  if (!connection) {
    debug("creating peer for incoming connection from peerId %s", fromPeerId);
    connection = createConnection(state, fromPeerId, false);
  }

  try {
    connection.peer.signal(signal.signal as SimplePeer.SignalData);
    debug("passed signal to peer %s", fromPeerId);
  } catch (err) {
    console.error("Failed to signal peer:", err);
  }
};

const createConnection = (
  state: VoiceState,
  peerId: number,
  initiator: boolean
): AudioConnection => {
  const isBidirectional = peerId > 0;

  const peer = new SimplePeer({
    initiator,
    stream: isBidirectional ? state.localStream! : undefined,
    trickle: true,
  });

  peer.on("signal", (data: SimplePeer.SignalData) => {
    sendSignal(state.network, peerId, data);
    debug("sent signal to peerId %s", peerId);
  });

  peer.on("stream", (remoteStream: MediaStream) => {
    debug("received stream from peerId %s", peerId);
    setupRemoteAudio(state, peerId, remoteStream);
  });

  peer.on("connect", () => {
    debug("connected to peerId %s", peerId);
  });

  peer.on("close", () => {
    debug("disconnected from peerId %s", peerId);
    cleanupConnection(state, peerId);
  });

  peer.on("error", (err: Error) => {
    console.error(`Peer error for peerId ${peerId}:`, err);
    cleanupConnection(state, peerId);
  });

  const gainNode = state.audioContext!.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(state.audioContext!.destination);

  const connection: AudioConnection = {
    peerId,
    peer,
    gainNode,
    sourceNode: null,
    audioElement: null,
  };

  state.connections.set(peerId, connection);
  return connection;
};

const setupRemoteAudio = (
  state: VoiceState,
  peerId: number,
  remoteStream: MediaStream
): void => {
  if (!state.audioContext) return;

  if (state.audioContext.state === "suspended") {
    debug("resuming suspended AudioContext");
    state.audioContext.resume();
  }

  const connection = state.connections.get(peerId);
  if (!connection) return;

  const audioElement = new Audio();
  audioElement.srcObject = remoteStream;
  audioElement.muted = true;
  audioElement.play().catch((e) => debug("audio element play failed: %s", e));

  const sourceNode = state.audioContext.createMediaStreamSource(remoteStream);
  sourceNode.connect(connection.gainNode);

  connection.sourceNode = sourceNode;
  connection.audioElement = audioElement;

  debug("audio setup complete for peerId %s", peerId);
};

const cleanupConnection = (state: VoiceState, peerId: number): void => {
  const connection = state.connections.get(peerId);
  if (!connection) return;

  try {
    if (connection.sourceNode) {
      connection.sourceNode.disconnect();
    }
    connection.gainNode.disconnect();
    if (connection.audioElement) {
      connection.audioElement.pause();
      connection.audioElement.srcObject = null;
    }
    connection.peer.destroy();
  } catch (e) {
    console.warn("exception while cleaning up connection", e);
  }

  state.connections.delete(peerId);
  debug("cleaned up connection: peerId %s", peerId);
};

export const callEmitter = (state: VoiceState, peerId: number): void => {
  if (peerId === state.myPeerId) {
    return;
  }

  if (state.connections.has(peerId)) {
    debug("already connected to peerId: %s", peerId);
    return;
  }

  const isBidirectional = peerId > 0;

  if (isBidirectional && state.myPeerId > peerId) {
    debug("skipping call to %s - they will call us", peerId);
    return;
  }

  if (isBidirectional && !state.localStream) {
    debug("cannot call player - stream not ready");
    return;
  }

  debug("calling peerId: %s", peerId);
  createConnection(state, peerId, true);
};

export const disconnectEmitter = (state: VoiceState, peerId: number): void => {
  cleanupConnection(state, peerId);
};

const calculateVolume = (
  localPos: { x: number; y: number },
  targetPos: { x: number; y: number }
): number => {
  const dx = targetPos.x - localPos.x;
  const dy = targetPos.y - localPos.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= VOICE_MIN_DISTANCE) {
    return 1;
  } else if (distance >= VOICE_MAX_DISTANCE) {
    return 0;
  } else {
    return (
      1 -
      (distance - VOICE_MIN_DISTANCE) /
        (VOICE_MAX_DISTANCE - VOICE_MIN_DISTANCE)
    );
  }
};

export const updateEmitterVolumes = (
  state: VoiceState,
  localPos: { x: number; y: number },
  positions: Map<number, { x: number; y: number }>
): void => {
  for (const connection of state.connections.values()) {
    const pos = positions.get(connection.peerId);
    connection.gainNode.gain.value = pos ? calculateVolume(localPos, pos) : 0;
  }
};

export const setMuted = (state: VoiceState, muted: boolean): void => {
  state.muted = muted;
  updateTrackEnabled(state);
  debug("mute state changed: %s", muted);
};

export const setVadEnabled = (state: VoiceState, enabled: boolean): void => {
  state.vadEnabled = enabled;
  state.vadActive = true;
  updateTrackEnabled(state);

  if (enabled && state.audioContext?.state === "suspended") {
    state.audioContext.resume();
  }

  debug("VAD enabled: %s", enabled);
};

export const setVadThreshold = (state: VoiceState, threshold: number): void => {
  state.vadThreshold = Math.max(0, Math.min(1, threshold));
  debug("VAD threshold: %s", state.vadThreshold);
};

const updateTrackEnabled = (state: VoiceState): void => {
  if (!state.localStream) return;

  const shouldEnable = !state.muted && (!state.vadEnabled || state.vadActive);

  for (const track of state.localStream.getAudioTracks()) {
    track.enabled = shouldEnable;
  }
};

const startVadLoop = (state: VoiceState): void => {
  let silentFrames = 0;
  const SILENCE_DELAY_FRAMES = 30;

  const checkVad = () => {
    if (!state.analyserNode || !state.vadEnabled) {
      silentFrames = 0;
      requestAnimationFrame(checkVad);
      return;
    }

    const dataArray = new Float32Array(state.analyserNode.fftSize);
    state.analyserNode.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const isAboveThreshold = rms > state.vadThreshold;

    if (isAboveThreshold) {
      silentFrames = 0;
      if (!state.vadActive) {
        state.vadActive = true;
        updateTrackEnabled(state);
        debug("VAD: speaking (level: %s)", rms.toFixed(4));
      }
    } else {
      silentFrames++;
      if (state.vadActive && silentFrames > SILENCE_DELAY_FRAMES) {
        state.vadActive = false;
        updateTrackEnabled(state);
        debug("VAD: silent (level: %s)", rms.toFixed(4));
      }
    }

    requestAnimationFrame(checkVad);
  };

  requestAnimationFrame(checkVad);
};

export const destroyVoice = (state: VoiceState): void => {
  for (const peerId of state.connections.keys()) {
    cleanupConnection(state, peerId);
  }

  if (state.localStream) {
    for (const track of state.localStream.getTracks()) {
      track.stop();
    }
  }

  if (state.audioContext) {
    state.audioContext.close();
  }

  state.network.onSignal = null;

  debug("voice chat destroyed");
};
