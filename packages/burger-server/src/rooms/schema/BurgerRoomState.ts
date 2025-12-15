import { Schema, type } from "@colyseus/schema";

export class BurgerRoomState extends Schema {
  @type("string") mySynchronizedProperty: string = "Hello world";
}
