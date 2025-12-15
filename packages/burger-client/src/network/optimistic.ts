import { addComponent, removeComponent, getRelationTargets } from "bitecs";
import type { Room } from "colyseus.js";
import type { BurgerRoomState } from "./types";
import type { GameWorld } from "../ecs/world";
import {
  HeldBy,
  SittingOn,
  Sprite,
  RigidBody,
  Collider,
} from "../ecs/components";
import { getEntityForServerItem, getServerItemForEntity } from "./item-sync";
import { getRapierWorld } from "../ecs/systems/physics";
import { Rapier } from "../setup";
import { TILE_WIDTH, TILE_HEIGHT } from "../vars";
import { getSessionId } from "./client";
import { findCounterAtPosition } from "../entities/items";

type OptimisticAction = {
  id: string;
  type: "pickup" | "drop";
  itemId: string;
  previousState: {
    x: number;
    y: number;
    heldBy: string;
  };
  timestamp: number;
};

const pendingActions = new Map<string, OptimisticAction>();
let actionCounter = 0;
let gameWorld: GameWorld | null = null;
let localPlayerEid: number | null = null;

export const initOptimistic = (world: GameWorld, playerEid: number): void => {
  gameWorld = world;
  localPlayerEid = playerEid;
};

export const applyOptimisticPickup = (
  room: Room<BurgerRoomState>,
  itemEid: number,
  playerEid: number
): string | null => {
  const itemId = getServerItemForEntity(itemEid);
  if (!itemId) return null;

  const item = room.state.items.get(itemId);
  if (!item) return null;

  // Store previous state for rollback
  const actionId = `action_${actionCounter++}`;
  pendingActions.set(actionId, {
    id: actionId,
    type: "pickup",
    itemId,
    previousState: {
      x: item.x,
      y: item.y,
      heldBy: item.heldBy,
    },
    timestamp: Date.now(),
  });

  // Apply optimistic update locally
  if (gameWorld) {
    // Remove collider so item doesn't block player
    const rapierWorld = getRapierWorld();
    const collider = Collider[itemEid];
    if (collider && rapierWorld) {
      rapierWorld.removeCollider(collider, false);
      Collider[itemEid] = null;
    }

    // Remove SittingOn relation
    const [counterEid] = getRelationTargets(gameWorld, itemEid, SittingOn);
    if (counterEid) {
      removeComponent(gameWorld, itemEid, SittingOn(counterEid));
    }

    // Add HeldBy relation
    addComponent(gameWorld, itemEid, HeldBy(playerEid));
  }

  // Note: Server determines what to pickup based on player position
  // The optimistic update is applied locally, server will confirm/reject

  return actionId;
};

export const applyOptimisticDrop = (
  room: Room<BurgerRoomState>,
  itemEid: number,
  playerEid: number,
  x: number,
  y: number,
  counterEid: number
): string | null => {
  const itemId = getServerItemForEntity(itemEid);
  if (!itemId) return null;

  const item = room.state.items.get(itemId);
  if (!item) return null;

  // Store previous state for rollback
  const actionId = `action_${actionCounter++}`;
  pendingActions.set(actionId, {
    id: actionId,
    type: "drop",
    itemId,
    previousState: {
      x: item.x,
      y: item.y,
      heldBy: item.heldBy,
    },
    timestamp: Date.now(),
  });

  // Apply optimistic update locally
  if (gameWorld) {
    const rapierWorld = getRapierWorld();

    // Remove HeldBy relation
    removeComponent(gameWorld, itemEid, HeldBy(playerEid));

    // Update sprite position
    const sprite = Sprite[itemEid];
    if (sprite) {
      sprite.x = x + TILE_WIDTH / 2;
      sprite.y = y + TILE_HEIGHT / 2;
    }

    // Update rigid body position and create new collider
    const rigidBody = RigidBody[itemEid];
    if (rigidBody && rapierWorld) {
      rigidBody.setTranslation({ x, y }, true);

      const colliderDesc = Rapier.ColliderDesc.cuboid(
        TILE_WIDTH / 2,
        TILE_HEIGHT / 2
      );
      const newCollider = rapierWorld.createCollider(colliderDesc, rigidBody);
      Collider[itemEid] = newCollider;
    }

    // Add SittingOn relation
    if (counterEid) {
      addComponent(gameWorld, itemEid, SittingOn(counterEid));
    }
  }

  // Note: Server determines where to drop based on player position
  // The optimistic update is applied locally, server will confirm/reject

  return actionId;
};

export const reconcileWithServer = (
  itemId: string,
  serverX: number,
  serverY: number,
  serverHeldBy: string
): void => {
  const itemEid = getEntityForServerItem(itemId);
  if (itemEid === undefined || !gameWorld) return;

  const sessionId = getSessionId();

  // Check if we have a pending action for this item
  for (const [actionId, action] of pendingActions) {
    if (action.itemId === itemId) {
      // Server has responded - clear pending action
      pendingActions.delete(actionId);
    }
  }

  // Apply server state
  const sprite = Sprite[itemEid];
  if (sprite) {
    sprite.x = serverX + TILE_WIDTH / 2;
    sprite.y = serverY + TILE_HEIGHT / 2;
  }

  const rigidBody = RigidBody[itemEid];
  if (rigidBody) {
    rigidBody.setTranslation({ x: serverX, y: serverY }, true);
  }

  // Update held state and SittingOn relation
  if (serverHeldBy !== "") {
    // Item is held by someone
    if (serverHeldBy === sessionId && localPlayerEid) {
      // We're holding it
      addComponent(gameWorld, itemEid, HeldBy(localPlayerEid));
    } else {
      // Someone else is holding it - remove HeldBy if we had it
      const [currentHolderEid] = getRelationTargets(gameWorld, itemEid, HeldBy);
      if (currentHolderEid && currentHolderEid === localPlayerEid) {
        removeComponent(gameWorld, itemEid, HeldBy(localPlayerEid));
      }
    }

    // Remove SittingOn relation (item is held, not on counter)
    const [currentCounterEid] = getRelationTargets(
      gameWorld,
      itemEid,
      SittingOn
    );
    if (currentCounterEid) {
      removeComponent(gameWorld, itemEid, SittingOn(currentCounterEid));
    }

    // Remove collider if held
    const rapierWorld = getRapierWorld();
    const collider = Collider[itemEid];
    if (collider && rapierWorld) {
      rapierWorld.removeCollider(collider, false);
      Collider[itemEid] = null;
    }
  } else {
    // Item is not held - ensure it's on a counter
    const rapierWorld = getRapierWorld();

    // Remove HeldBy relation if it exists
    const [currentHolderEid] = getRelationTargets(gameWorld, itemEid, HeldBy);
    if (currentHolderEid) {
      removeComponent(gameWorld, itemEid, HeldBy(currentHolderEid));
    }

    // Find counter at this position
    const counterEid = findCounterAtPosition(gameWorld, serverX, serverY);

    // Update SittingOn relation
    const [currentCounterEid] = getRelationTargets(
      gameWorld,
      itemEid,
      SittingOn
    );
    if (counterEid && counterEid !== currentCounterEid) {
      // Remove old relation if different
      if (currentCounterEid) {
        removeComponent(gameWorld, itemEid, SittingOn(currentCounterEid));
      }
      // Add new relation
      addComponent(gameWorld, itemEid, SittingOn(counterEid));
    } else if (!counterEid && currentCounterEid) {
      // No counter found, remove relation
      removeComponent(gameWorld, itemEid, SittingOn(currentCounterEid));
    }

    // Ensure collider exists
    if (!Collider[itemEid] && rigidBody && rapierWorld) {
      const colliderDesc = Rapier.ColliderDesc.cuboid(
        TILE_WIDTH / 2,
        TILE_HEIGHT / 2
      );
      const newCollider = rapierWorld.createCollider(colliderDesc, rigidBody);
      Collider[itemEid] = newCollider;
    }
  }
};

// Clean up stale pending actions (timeout)
export const cleanupPendingActions = (): void => {
  const now = Date.now();
  const timeout = 2000; // 2 seconds

  for (const [actionId, action] of pendingActions) {
    if (now - action.timestamp > timeout) {
      console.warn(`Action ${actionId} timed out, reverting`);
      // Could implement rollback here if needed
      pendingActions.delete(actionId);
    }
  }
};

export const hasPendingAction = (itemId: string): boolean => {
  for (const action of pendingActions.values()) {
    if (action.itemId === itemId) return true;
  }
  return false;
};
