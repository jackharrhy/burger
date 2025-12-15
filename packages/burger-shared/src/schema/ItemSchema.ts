import { Schema, type } from "@colyseus/schema";

export type ItemType = "uncooked_patty" | "cooked_patty";
export type ItemState = "on_counter" | "held" | "cooking";

export class ItemSchema extends Schema {
  @type("string") id: string = "";
  @type("string") itemType: ItemType = "uncooked_patty";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") state: ItemState = "on_counter";
  @type("string") heldBy: string = ""; // sessionId or empty
  @type("number") cookingProgress: number = 0; // 0-1
}
