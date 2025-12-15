import { Room, Client } from "colyseus";
import debugFactory from "debug";
import { BurgerRoomState } from "./schema/BurgerRoomState";
import {
  PlayerSchema,
  TILE_WIDTH,
  PLAYER_SIZE,
  setupCookingObservers,
} from "@burger-king/shared";
import {
  addComponent,
  removeComponent,
  getRelationTargets,
  query,
} from "bitecs";
import {
  HeldBy,
  SittingOn,
  Position,
  FacingDirection,
} from "@burger-king/shared";
import { createServerWorld, type ServerWorld } from "../ecs/world";
import {
  setupServerLevel,
  findCounterAtPosition,
  createInitialSchemaFromEcs,
} from "../ecs/level";
import { createServerPlayer } from "../ecs/entities";
import {
  syncItemEcsToSchema,
  syncPlayerEcsToSchema,
  getItemEid,
  getPlayerEid,
  getItemId,
  unregisterPlayerMapping,
} from "../ecs/sync";
import { cookingSystem } from "../ecs/systems/cooking";
import {
  findBestHoldable,
  findBestCounter,
  type BestCounterResult,
} from "../ecs/interaction";

const debug = debugFactory("burger:server:BurgerRoom");

type InputMessage = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  facingX: number;
  facingY: number;
};

type InteractMessage = {
  action: "interact";
};

export class BurgerRoom extends Room<BurgerRoomState> {
  maxClients = 4;
  fixedTimeStep = 1000 / 60;

  private world: ServerWorld | null = null;
  private playerInputs = new Map<string, InputMessage>();
  private playerSpawn = { x: 104, y: 104 };
  private itemEids = new Map<string, number>();

  onCreate() {
    this.state = new BurgerRoomState();

    this.world = createServerWorld();
    if (!this.world) {
      throw new Error("Failed to create server ECS world");
    }

    const levelSetup = setupServerLevel(this.world);
    this.itemEids = levelSetup.itemEids;

    setupCookingObservers(this.world);

    const initialItems = createInitialSchemaFromEcs(this.world, this.itemEids);
    for (const [itemId, itemSchema] of initialItems) {
      this.state.items.set(itemId, itemSchema);
    }

    const { loadLevelData } = require("@burger-king/shared");
    const levelData = loadLevelData();
    if (levelData.playerSpawn) {
      this.playerSpawn = levelData.playerSpawn;
    }

    debug("Server ECS world initialized with %d items", this.itemEids.size);

    this.onMessage("input", (client, message: InputMessage) => {
      this.playerInputs.set(client.sessionId, message);
    });

    this.onMessage("interact", (client, _message: InteractMessage) => {
      this.handleInteract(client.sessionId);
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  onJoin(client: Client) {
    debug("Player joined: %s", client.sessionId);

    if (!this.world) return;

    const offset = this.state.players.size * TILE_WIDTH;
    const playerX = this.playerSpawn.x + offset;
    const playerY = this.playerSpawn.y;

    const playerEid = createServerPlayer(
      this.world,
      client.sessionId,
      playerX,
      playerY
    );

    const player = new PlayerSchema();
    player.sessionId = client.sessionId;
    syncPlayerEcsToSchema(this.world, playerEid, player);

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    debug("Player left: %s", client.sessionId);

    if (!this.world) return;

    const playerEid = getPlayerEid(client.sessionId);
    if (playerEid !== undefined) {
      for (const [itemId, itemEid] of this.itemEids) {
        const [heldByEid] = getRelationTargets(this.world, itemEid, HeldBy);
        if (heldByEid === playerEid) {
          const playerX = Position.x[playerEid];
          const playerY = Position.y[playerEid];

          const counterEid = findCounterAtPosition(
            this.world,
            playerX,
            playerY
          );

          if (counterEid) {
            this.performDrop(itemEid, counterEid, playerX, playerY);
          } else {
            removeComponent(this.world, itemEid, HeldBy(playerEid));
            Position.x[itemEid] = playerX;
            Position.y[itemEid] = playerY;
          }

          const itemSchema = this.state.items.get(itemId);
          if (itemSchema) {
            syncItemEcsToSchema(this.world, itemEid, itemSchema);
          }
        }
      }

      unregisterPlayerMapping(client.sessionId);
    }

    this.state.players.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);
  }

  private handleInteract(sessionId: string) {
    if (!this.world) return;

    const playerEid = getPlayerEid(sessionId);
    if (!playerEid) return;

    const playerX = Position.x[playerEid];
    const playerY = Position.y[playerEid];
    const facingX = FacingDirection.x[playerEid];
    const facingY = FacingDirection.y[playerEid];

    debug(
      "Interact from %s at (%d, %d) facing (%d, %d)",
      sessionId,
      playerX,
      playerY,
      facingX,
      facingY
    );

    const heldItems = query(this.world, [HeldBy(playerEid)]);
    const isHolding = heldItems.length > 0;

    if (isHolding) {
      debug("Player %s is holding item, trying to drop/swap", sessionId);
      const counter = findBestCounter(
        this.world,
        playerX,
        playerY,
        facingX,
        facingY
      );
      if (!counter) {
        debug("No counter found for drop");
        return;
      }

      debug(
        "Found counter %d at (%d, %d), occupied=%s",
        counter.eid,
        counter.x,
        counter.y,
        counter.occupied
      );

      if (counter.occupied) {
        this.handleSwap(sessionId, playerEid, heldItems[0], counter);
      } else {
        this.handleDrop(sessionId, playerEid, heldItems[0], counter);
      }
    } else {
      debug("Player %s is not holding, trying to pickup", sessionId);
      const item = findBestHoldable(
        this.world,
        playerX,
        playerY,
        facingX,
        facingY
      );
      if (!item) {
        debug("No holdable item found");
        return;
      }

      this.handlePickup(sessionId, playerEid, item.eid, item.itemId);
    }
  }

  private handlePickup(
    sessionId: string,
    playerEid: number,
    itemEid: number,
    itemId: string
  ) {
    if (!this.world) return;

    this.performPickup(playerEid, itemEid);

    const itemSchema = this.state.items.get(itemId);
    if (itemSchema) {
      syncItemEcsToSchema(this.world, itemEid, itemSchema);
    }

    debug("Pickup: player=%s item=%s eid=%d", sessionId, itemId, itemEid);
  }

  private handleDrop(
    sessionId: string,
    playerEid: number,
    itemEid: number,
    counter: BestCounterResult
  ) {
    if (!this.world || !counter) return;

    const itemId = getItemId(itemEid);
    if (!itemId) return;

    this.performDrop(itemEid, counter.eid, counter.x, counter.y);

    const itemSchema = this.state.items.get(itemId);
    if (itemSchema) {
      syncItemEcsToSchema(this.world, itemEid, itemSchema);
    }

    debug(
      "Drop: player=%s item=%s at (%d, %d) counter=%d",
      sessionId,
      itemId,
      counter.x,
      counter.y,
      counter.eid
    );
  }

  private handleSwap(
    sessionId: string,
    playerEid: number,
    heldItemEid: number,
    counter: BestCounterResult
  ) {
    if (!this.world || !counter) return;

    const itemToPickup = findBestHoldable(
      this.world,
      Position.x[playerEid],
      Position.y[playerEid],
      FacingDirection.x[playerEid],
      FacingDirection.y[playerEid],
      heldItemEid
    );
    if (!itemToPickup) return;

    const heldItemId = getItemId(heldItemEid);
    if (!heldItemId) return;

    this.performPickup(playerEid, itemToPickup.eid);

    this.performDrop(heldItemEid, counter.eid, counter.x, counter.y);

    const heldItemSchema = this.state.items.get(heldItemId);
    if (heldItemSchema) {
      syncItemEcsToSchema(this.world, heldItemEid, heldItemSchema);
    }

    const pickupItemSchema = this.state.items.get(itemToPickup.itemId);
    if (pickupItemSchema) {
      syncItemEcsToSchema(this.world, itemToPickup.eid, pickupItemSchema);
    }

    debug(
      "Swap: player=%s dropped=%s picked=%s at counter=%d",
      sessionId,
      heldItemId,
      itemToPickup.itemId,
      counter.eid
    );
  }

  private performPickup(playerEid: number, itemEid: number) {
    if (!this.world) return;

    const [counterEid] = getRelationTargets(this.world, itemEid, SittingOn);
    if (counterEid) {
      removeComponent(this.world, itemEid, SittingOn(counterEid));
    }

    addComponent(this.world, itemEid, HeldBy(playerEid));
  }

  private performDrop(
    itemEid: number,
    counterEid: number,
    x: number,
    y: number
  ) {
    if (!this.world) return;

    const [heldByPlayerEid] = getRelationTargets(this.world, itemEid, HeldBy);
    if (heldByPlayerEid) {
      removeComponent(this.world, itemEid, HeldBy(heldByPlayerEid));
    }

    Position.x[itemEid] = x;
    Position.y[itemEid] = y;

    addComponent(this.world, itemEid, SittingOn(counterEid));
  }

  update(_deltaTime: number) {
    if (!this.world) return;

    const deltaTimeSeconds = _deltaTime / 1000;

    this.state.players.forEach((player, sessionId) => {
      const input = this.playerInputs.get(sessionId);
      if (!input) return;

      const playerEid = getPlayerEid(sessionId);
      if (!playerEid) return;

      Position.x[playerEid] = input.x;
      Position.y[playerEid] = input.y;
      FacingDirection.x[playerEid] = input.facingX;
      FacingDirection.y[playerEid] = input.facingY;

      syncPlayerEcsToSchema(this.world!, playerEid, player);
    });

    for (const [itemId, itemEid] of this.itemEids) {
      const [heldByEid] = getRelationTargets(this.world, itemEid, HeldBy);
      if (!heldByEid) continue;

      const playerX = Position.x[heldByEid];
      const playerY = Position.y[heldByEid];
      const facingX = FacingDirection.x[heldByEid];
      const facingY = FacingDirection.y[heldByEid];

      Position.x[itemEid] = playerX + facingX * PLAYER_SIZE;
      Position.y[itemEid] = playerY + facingY * PLAYER_SIZE;

      const itemSchema = this.state.items.get(itemId);
      if (itemSchema) {
        syncItemEcsToSchema(this.world, itemEid, itemSchema);
      }
    }

    cookingSystem(this.world, deltaTimeSeconds);

    for (const [itemId, itemSchema] of this.state.items) {
      const eid = getItemEid(itemId);
      if (eid !== undefined) {
        syncItemEcsToSchema(this.world, eid, itemSchema);
      }
    }
  }

  onDispose() {
    debug("Room %s disposing", this.roomId);
  }
}
