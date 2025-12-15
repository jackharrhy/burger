import type { Schema, MapSchema } from "@colyseus/schema";
import type { PlayerSchema, ItemSchema } from "@burger-king/shared";

export interface BurgerRoomState extends Schema {
  players: MapSchema<PlayerSchema>;
  items: MapSchema<ItemSchema>;
}
