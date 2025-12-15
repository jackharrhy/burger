import { Schema, type } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("string") sessionId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") facingX: number = 1;
  @type("number") facingY: number = 0;
}
