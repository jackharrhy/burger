import { Client, Room } from "colyseus.js";
import type { BurgerRoomState } from "./types";

let client: Client | null = null;
let room: Room<BurgerRoomState> | null = null;

export const connect = async (
  serverUrl: string = "ws://localhost:2567"
): Promise<Room<BurgerRoomState>> => {
  client = new Client(serverUrl);
  room = await client.joinOrCreate<BurgerRoomState>("burger_room");
  console.log("Connected to room:", room.roomId);
  return room;
};

export const getRoom = (): Room<BurgerRoomState> | null => room;

export const getSessionId = (): string | null => room?.sessionId ?? null;

export const disconnect = (): void => {
  room?.leave();
  room = null;
  client = null;
};
