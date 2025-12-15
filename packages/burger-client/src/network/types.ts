import type { Schema, MapSchema } from "@colyseus/schema";
import type { PlayerSchema } from "@burger-king/shared";

export interface BurgerRoomState extends Schema {
  players: MapSchema<PlayerSchema>;
}
