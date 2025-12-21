/**
 * Proximity Voice Chat using PeerJS
 *
 * Uses WebRTC peer-to-peer connections for audio,
 * with Web Audio API GainNodes for distance-based volume control.
 */

import Peer, { type MediaConnection } from "peerjs";
import {
  PEERJS_CONFIG,
  VOICE_MAX_DISTANCE,
  VOICE_MIN_DISTANCE,
} from "./consts.client";
import debugFactory from "debug";

const debug = debugFactory("burger:voice");

type PeerConnection = {
  call: MediaConnection;
  gainNode: GainNode;
  sourceNode: MediaStreamAudioSourceNode;
  audioElement: HTMLAudioElement;
  serverEid: number;
};

export type VoiceState = {
  peer: Peer | null;
  audioContext: AudioContext | null;
  localStream: MediaStream | null;
  connections: Map<number, PeerConnection>; // serverEid -> connection
  muted: boolean;
  myServerEid: number;
  peerReady: boolean;
  vadEnabled: boolean;
  vadThreshold: number;
  analyserNode: AnalyserNode | null;
  vadActive: boolean;
};

const getPeerId = (serverEid: number): string => `burger-${serverEid}`;

const parseServerEid = (peerId: string): number | null => {
  const match = peerId.match(/^burger-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
};

export const initVoice = async (
  serverEid: number,
  onReady?: () => void,
): Promise<VoiceState> => {
  const state: VoiceState = {
    peer: null,
    audioContext: null,
    localStream: null,
    connections: new Map(),
    muted: false,
    myServerEid: serverEid,
    peerReady: false,
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

    const peer = new Peer(getPeerId(serverEid), PEERJS_CONFIG);
    state.peer = peer;

    peer.on("open", (id) => {
      debug("connected to PeerJS server with id: %s", id);
      state.peerReady = true;
      if (onReady) {
        onReady();
      }
    });

    peer.on("error", (err) => {
      console.error("PeerJS error:", err);
    });

    peer.on("call", (call) => {
      debug("incoming call from: %s", call.peer);
      const callerServerEid = parseServerEid(call.peer);
      if (callerServerEid === null) {
        debug("ignoring call from unknown peer: %s", call.peer);
        return;
      }

      call.answer(state.localStream!);

      call.on("stream", (remoteStream) => {
        debug("received stream from: %s", call.peer);
        setupRemoteAudio(state, callerServerEid, call, remoteStream);
      });

      call.on("close", () => {
        debug("call closed from: %s", call.peer);
        cleanupConnection(state, callerServerEid);
      });

      call.on("error", (err) => {
        console.error("Call error from %s:", call.peer, err);
        cleanupConnection(state, callerServerEid);
      });
    });

    peer.on("disconnected", () => {
      debug("disconnected from PeerJS server, attempting reconnect...");
      peer.reconnect();
    });

    return state;
  } catch (err) {
    console.error("Failed to initialize voice chat:", err);
    return state;
  }
};

const setupRemoteAudio = (
  state: VoiceState,
  serverEid: number,
  call: MediaConnection,
  remoteStream: MediaStream,
): void => {
  if (!state.audioContext) return;

  if (state.audioContext.state === "suspended") {
    debug("resuming suspended AudioContext");
    state.audioContext.resume();
  }

  cleanupConnection(state, serverEid);

  const audioElement = new Audio();
  audioElement.srcObject = remoteStream;
  audioElement.muted = true;
  audioElement.play().catch((e) => debug("audio element play failed: %s", e));

  const sourceNode = state.audioContext.createMediaStreamSource(remoteStream);
  const gainNode = state.audioContext.createGain();
  gainNode.gain.value = 0;

  sourceNode.connect(gainNode);
  gainNode.connect(state.audioContext.destination);

  state.connections.set(serverEid, {
    call,
    gainNode,
    sourceNode,
    audioElement,
    serverEid,
  });

  debug("audio setup complete for player: %s", serverEid);
};

export const callPlayer = (
  state: VoiceState,
  targetServerEid: number,
): void => {
  if (!state.peer || !state.localStream) {
    debug("cannot call player - peer or stream not ready");
    return;
  }

  if (!state.peerReady) {
    debug("cannot call player - peer not connected to server yet");
    return;
  }

  if (state.connections.has(targetServerEid)) {
    debug("already connected to player: %s", targetServerEid);
    return;
  }

  if (state.myServerEid > targetServerEid) {
    debug("skipping call to %s - they will call us", targetServerEid);
    return;
  }

  const targetPeerId = getPeerId(targetServerEid);
  debug("calling player: %s", targetPeerId);

  const call = state.peer.call(targetPeerId, state.localStream);

  call.on("stream", (remoteStream) => {
    debug("received stream from called player: %s", targetPeerId);
    setupRemoteAudio(state, targetServerEid, call, remoteStream);
  });

  call.on("close", () => {
    debug("call closed to: %s", targetPeerId);
    cleanupConnection(state, targetServerEid);
  });

  call.on("error", (err) => {
    console.error("Call error to %s:", targetPeerId, err);
    cleanupConnection(state, targetServerEid);
  });
};

const cleanupConnection = (state: VoiceState, serverEid: number): void => {
  const connection = state.connections.get(serverEid);
  if (!connection) return;

  try {
    connection.sourceNode.disconnect();
    connection.gainNode.disconnect();
    connection.audioElement.pause();
    connection.audioElement.srcObject = null;
    connection.call.close();
  } catch (e) {
    console.warn("exceptio while cleaning up", e);
  }

  state.connections.delete(serverEid);
  debug("cleaned up connection to player: %s", serverEid);
};

export const disconnectPlayer = (
  state: VoiceState,
  serverEid: number,
): void => {
  cleanupConnection(state, serverEid);
};

export const updateProximityVolumes = (
  state: VoiceState,
  localPos: { x: number; y: number },
  playerPositions: Map<number, { x: number; y: number }>,
): void => {
  for (const [serverEid, connection] of state.connections) {
    const pos = playerPositions.get(serverEid);
    if (!pos) {
      connection.gainNode.gain.value = 0;
      continue;
    }

    const dx = pos.x - localPos.x;
    const dy = pos.y - localPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let volume: number;
    if (distance <= VOICE_MIN_DISTANCE) {
      volume = 1;
    } else if (distance >= VOICE_MAX_DISTANCE) {
      volume = 0;
    } else {
      volume =
        1 -
        (distance - VOICE_MIN_DISTANCE) /
          (VOICE_MAX_DISTANCE - VOICE_MIN_DISTANCE);
    }

    connection.gainNode.gain.value = volume;
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

export const getServerEidFromClientEid = (
  clientEid: number,
  idMap: Map<number, number>,
): number | null => {
  for (const [serverEid, cEid] of idMap) {
    if (cEid === clientEid) {
      return serverEid;
    }
  }
  return null;
};

export const destroyVoice = (state: VoiceState): void => {
  for (const serverEid of state.connections.keys()) {
    cleanupConnection(state, serverEid);
  }

  if (state.localStream) {
    for (const track of state.localStream.getTracks()) {
      track.stop();
    }
  }

  if (state.audioContext) {
    state.audioContext.close();
  }

  if (state.peer) {
    state.peer.destroy();
  }

  debug("voice chat destroyed");
};
