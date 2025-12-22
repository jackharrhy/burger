/**
 * Radio Manager - Spawns and manages the burger-radio subprocess
 *
 * Communicates with the radio process via stdin/stdout JSON IPC.
 */

import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import debugFactory from "debug";
import type { SignalMessage } from "burger-shared";
import { setRadioSignalHandler, sendSignalToPlayer } from "./network.server";

const debug = debugFactory("burger:radio-manager");

const __dirname = dirname(fileURLToPath(import.meta.url));

type RadioReadyCallback = (eid: number) => void;
type RadioErrorCallback = (eid: number, error: string) => void;

type RadioManagerState = {
  process: ChildProcess | null;
  ready: boolean;
  pendingRadios: Map<
    number,
    { resolve: () => void; reject: (err: Error) => void }
  >;
  onRadioReady?: RadioReadyCallback;
  onRadioError?: RadioErrorCallback;
};

const state: RadioManagerState = {
  process: null,
  ready: false,
  pendingRadios: new Map(),
};

type IPCResponse = {
  type: "ready" | "stopped" | "error" | "signal";
  eid?: number;
  error?: string;
  to?: number;
  signal?: unknown;
};

const sendMessage = (message: object): void => {
  if (!state.process || !state.process.stdin) {
    debug("cannot send message - process not running");
    return;
  }
  state.process.stdin.write(JSON.stringify(message) + "\n");
};

const handleResponse = (response: IPCResponse): void => {
  switch (response.type) {
    case "ready": {
      if (response.eid !== undefined) {
        const pending = state.pendingRadios.get(response.eid);
        if (pending) {
          pending.resolve();
          state.pendingRadios.delete(response.eid);
        }
        state.onRadioReady?.(response.eid);
        debug("radio %s is ready", response.eid);
      } else {
        state.ready = true;
        debug("radio process is ready");
      }
      break;
    }

    case "stopped": {
      if (response.eid !== undefined) {
        debug("radio %s stopped", response.eid);
      } else {
        debug("all radios stopped");
      }
      break;
    }

    case "error": {
      if (response.eid !== undefined) {
        const pending = state.pendingRadios.get(response.eid);
        if (pending) {
          pending.reject(new Error(response.error || "Unknown error"));
          state.pendingRadios.delete(response.eid);
        }
        state.onRadioError?.(response.eid, response.error || "Unknown error");
      }
      console.error("Radio error:", response.error);
      break;
    }

    case "signal": {
      if (response.to !== undefined && response.eid !== undefined) {
        const signalMsg: SignalMessage = {
          from: -response.eid, // Negative eid indicates radio
          to: response.to,
          signal: response.signal,
        };
        sendSignalToPlayer(response.to, signalMsg);
        debug(
          "forwarded signal from radio %s to player %s",
          response.eid,
          response.to,
        );
      }
      break;
    }
  }
};

export const initRadioManager = async (options?: {
  onRadioReady?: RadioReadyCallback;
  onRadioError?: RadioErrorCallback;
}): Promise<void> => {
  if (state.process) {
    debug("radio manager already initialized");
    return;
  }

  state.onRadioReady = options?.onRadioReady;
  state.onRadioError = options?.onRadioError;

  return new Promise((resolve, reject) => {
    const radioPackagePath = join(__dirname, "../../burger-radio");

    debug("spawning radio process from %s", radioPackagePath);

    const proc = spawn("node", ["--import", "tsx", "src/index.ts"], {
      cwd: radioPackagePath,
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        DEBUG: process.env.DEBUG || "burger:*",
      },
    });

    state.process = proc;

    setRadioSignalHandler((signal: SignalMessage) => {
      const radioEid = Math.abs(signal.to);
      sendMessage({
        type: "signal",
        radioEid,
        from: signal.from,
        signal: signal.signal,
      });
      debug(
        "forwarded signal from player %s to radio %s",
        signal.from,
        radioEid,
      );
    });

    let buffer = "";
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      buffer += chunk;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line) as IPCResponse;
            handleResponse(response);

            if (response.type === "ready" && response.eid === undefined) {
              resolve();
            }
          } catch (err) {
            debug("failed to parse response: %s", err);
          }
        }
      }
    });

    proc.on("error", (err) => {
      console.error("Radio process error:", err);
      state.process = null;
      state.ready = false;
      reject(err);
    });

    proc.on("exit", (code, signal) => {
      debug("radio process exited with code=%s signal=%s", code, signal);
      state.process = null;
      state.ready = false;
    });

    setTimeout(() => {
      if (!state.ready) {
        reject(new Error("Radio process failed to start within timeout"));
      }
    }, 10000);
  });
};

export const startRadio = async (
  eid: number,
  audioFile?: string,
): Promise<void> => {
  if (!state.process || !state.ready) {
    throw new Error("Radio manager not initialized");
  }

  return new Promise((resolve, reject) => {
    state.pendingRadios.set(eid, { resolve, reject });

    sendMessage({
      type: "start",
      eid,
      audioFile,
    });

    setTimeout(() => {
      if (state.pendingRadios.has(eid)) {
        state.pendingRadios.delete(eid);
        reject(new Error(`Radio ${eid} failed to start within timeout`));
      }
    }, 10000);
  });
};

export const stopRadio = (eid: number): void => {
  if (!state.process) return;

  sendMessage({
    type: "stop",
    eid,
  });
};

export const stopAllRadios = (): void => {
  if (!state.process) return;

  sendMessage({
    type: "stopAll",
  });
};

export const shutdownRadioManager = (): void => {
  if (!state.process) return;

  debug("shutting down radio manager");
  stopAllRadios();

  setTimeout(() => {
    if (state.process) {
      state.process.kill("SIGTERM");
      state.process = null;
    }
  }, 100);

  state.ready = false;
};

export const notifyPlayerDisconnect = (playerEid: number): void => {
  if (!state.process || !state.ready) return;

  sendMessage({
    type: "playerDisconnect",
    playerEid,
  });

  debug("notified radio of player %s disconnect", playerEid);
};
