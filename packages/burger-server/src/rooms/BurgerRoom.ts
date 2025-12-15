import { Room, Client } from "colyseus";
import { BurgerRoomState } from "./schema/BurgerRoomState";

export class BurgerRoom extends Room<BurgerRoomState> {
  maxClients = 4;
  state = new BurgerRoomState();

  onCreate(options: any) {
    this.onMessage("type", (client, message) => {
      //
      // handle "type" message
      //
    });
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}
