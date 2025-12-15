import { Room, Client } from "colyseus";
import { BurgerRoomState } from "./schema/BurgerRoomState";
import { PlayerSchema } from "@burger-king/shared";

type InputMessage = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  facingX: number;
  facingY: number;
};

const SPAWN_POSITIONS = [
  { x: 104, y: 104 },
  { x: 136, y: 104 },
  { x: 104, y: 136 },
  { x: 136, y: 136 },
];

export class BurgerRoom extends Room<BurgerRoomState> {
  maxClients = 4;
  fixedTimeStep = 1000 / 60;

  private playerInputs = new Map<string, InputMessage>();

  onCreate() {
    this.state = new BurgerRoomState();

    this.onMessage("input", (client, message: InputMessage) => {
      this.playerInputs.set(client.sessionId, message);
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  onJoin(client: Client) {
    console.log(client.sessionId, "joined!");

    const player = new PlayerSchema();
    player.sessionId = client.sessionId;

    const spawnIndex = this.state.players.size % SPAWN_POSITIONS.length;
    const spawn = SPAWN_POSITIONS[spawnIndex];
    player.x = spawn.x;
    player.y = spawn.y;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);
  }

  update(_deltaTime: number) {
    this.state.players.forEach((player, sessionId) => {
      const input = this.playerInputs.get(sessionId);
      if (!input) return;

      player.x = input.x;
      player.y = input.y;
      player.facingX = input.facingX;
      player.facingY = input.facingY;
    });
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}
