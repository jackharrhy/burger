/**
 * Radio Server Entry Point
 *
 * Runs as a separate Node.js process, communicates with burger-server via stdin/stdout.
 * Streams audio to game clients via WebRTC using simple-peer.
 */

import { startRadio, stopRadio, stopAllRadios, handleSignal } from "./radio.js";
import debugFactory from "debug";

const debug = debugFactory("burger:radio");

type StartRadioMessage = {
  type: "start";
  eid: number;
  audioFile?: string;
};

type StopRadioMessage = {
  type: "stop";
  eid: number;
};

type StopAllMessage = {
  type: "stopAll";
};

type SignalMessage = {
  type: "signal";
  radioEid: number;
  from: number; // player serverEid
  signal: unknown;
};

type IPCMessage =
  | StartRadioMessage
  | StopRadioMessage
  | StopAllMessage
  | SignalMessage;

type IPCResponse = {
  type: "ready" | "stopped" | "error" | "signal";
  eid?: number;
  error?: string;
  to?: number;
  signal?: unknown;
};

export const sendResponse = (response: IPCResponse): void => {
  process.stdout.write(JSON.stringify(response) + "\n");
};

const handleMessage = async (message: IPCMessage): Promise<void> => {
  switch (message.type) {
    case "start": {
      debug("starting radio eid=%s", message.eid);
      try {
        await startRadio(message.eid, message.audioFile);
        sendResponse({ type: "ready", eid: message.eid });
      } catch (err) {
        sendResponse({
          type: "error",
          eid: message.eid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "stop": {
      debug("stopping radio eid=%s", message.eid);
      stopRadio(message.eid);
      sendResponse({ type: "stopped", eid: message.eid });
      break;
    }

    case "stopAll": {
      debug("stopping all radios");
      stopAllRadios();
      sendResponse({ type: "stopped" });
      break;
    }

    case "signal": {
      debug(
        "received signal from player %s for radio %s",
        message.from,
        message.radioEid,
      );
      handleSignal(message.radioEid, message.from, message.signal);
      break;
    }
  }
};

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;

  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (line.trim()) {
      try {
        const message = JSON.parse(line) as IPCMessage;
        handleMessage(message);
      } catch (err) {
        debug("failed to parse message: %s", err);
        sendResponse({
          type: "error",
          error: `Invalid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }
});

process.stdin.on("end", () => {
  debug("stdin closed, shutting down");
  stopAllRadios();
  process.exit(0);
});

process.on("SIGTERM", () => {
  debug("received SIGTERM, shutting down");
  stopAllRadios();
  process.exit(0);
});

process.on("SIGINT", () => {
  debug("received SIGINT, shutting down");
  stopAllRadios();
  process.exit(0);
});

debug("radio server started, waiting for commands");
sendResponse({ type: "ready" });
