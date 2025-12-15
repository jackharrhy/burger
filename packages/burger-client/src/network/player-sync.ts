import { Room, getStateCallbacks } from "colyseus.js";
import type { PlayerSchema } from "@burger-king/shared";
import type { BurgerRoomState } from "./types";
import type { GameWorld } from "../ecs/world";
import {
  createRemotePlayer,
  removeRemotePlayer,
  updateRemotePlayerPosition,
} from "../entities/remote-player";
import { FacingDirection } from "../ecs/components";

let gameWorld: GameWorld | null = null;
let localSessionId: string | null = null;

export const setupPlayerSync = (
  room: Room<BurgerRoomState>,
  world: GameWorld
): void => {
  gameWorld = world;
  localSessionId = room.sessionId;

  // Get callback wrapper for state changes
  const $ = getStateCallbacks(room);

  $(room.state).players.onAdd((player: PlayerSchema, sessionId: string) => {
    console.log("Player joined:", sessionId);

    // Don't create a remote entity for the local player
    if (sessionId === localSessionId) {
      console.log("Skipping local player spawn");
      return;
    }

    if (!gameWorld) return;
    createRemotePlayer(gameWorld, sessionId, player.x, player.y);

    // Listen for property changes using $()
    $(player).listen("x", () => {
      updateRemotePlayerPosition(
        sessionId,
        player.x,
        player.y,
        player.facingX,
        player.facingY
      );
    });

    $(player).listen("y", () => {
      updateRemotePlayerPosition(
        sessionId,
        player.x,
        player.y,
        player.facingX,
        player.facingY
      );
    });
  });

  $(room.state).players.onRemove((_player: PlayerSchema, sessionId: string) => {
    console.log("Player left:", sessionId);

    if (sessionId === localSessionId) return;
    if (!gameWorld) return;

    removeRemotePlayer(gameWorld, sessionId);
  });
};

export type InputMessage = {
  // Absolute position (from client physics)
  x: number;
  y: number;
  // Input direction (for velocity/animations)
  dx: number;
  dy: number;
  // Facing direction
  facingX: number;
  facingY: number;
};

export const sendInput = (
  room: Room<BurgerRoomState>,
  localPlayerEid: number,
  dx: number,
  dy: number,
  x: number,
  y: number
): void => {
  const message: InputMessage = {
    x,
    y,
    dx,
    dy,
    facingX: FacingDirection.x[localPlayerEid],
    facingY: FacingDirection.y[localPlayerEid],
  };

  room.send("input", message);
};
