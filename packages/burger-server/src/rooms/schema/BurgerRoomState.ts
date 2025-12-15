import { Schema, type, MapSchema } from "@colyseus/schema";
import { PlayerSchema, ItemSchema } from "@burger-king/shared";

export class BurgerRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: ItemSchema }) items = new MapSchema<ItemSchema>();
}
