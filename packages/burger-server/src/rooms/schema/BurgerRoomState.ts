import { Schema, type, MapSchema } from "@colyseus/schema";
import { PlayerSchema } from "@burger-king/shared";

export class BurgerRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
