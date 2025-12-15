import { Room, getStateCallbacks } from "colyseus.js";
import { addEntity, addComponent, removeEntity, removeComponent } from "bitecs";
import * as Pixi from "pixi.js";
import type { ItemSchema } from "@burger-king/shared";
import type { BurgerRoomState } from "./types";
import type { GameWorld } from "../ecs/world";
import {
  Holdable,
  UncookedPatty,
  CookedPatty,
  Sprite,
  RigidBody,
  Collider,
  NetworkId,
} from "../ecs/components";
import { getRapierWorld } from "../ecs/systems/physics";
import { Rapier, entityContainer } from "../setup";
import { TILE_WIDTH, TILE_HEIGHT } from "../vars";
import { reconcileWithServer } from "./optimistic";

// Map server item IDs to local entity IDs
const serverItemToEntity = new Map<string, number>();
const entityToServerItem = new Map<number, string>();

let gameWorld: GameWorld | null = null;

export const setupItemSync = (
  room: Room<BurgerRoomState>,
  world: GameWorld
): void => {
  gameWorld = world;

  const $ = getStateCallbacks(room);

  $(room.state).items.onAdd((item: ItemSchema, itemId: string) => {
    console.log("Item added:", itemId, item.itemType);

    if (!gameWorld) return;
    const eid = createItemEntity(gameWorld, item);
    serverItemToEntity.set(itemId, eid);
    entityToServerItem.set(eid, itemId);

    // Listen for position changes
    $(item).listen("x", () => {
      updateItemPosition(itemId, item);
    });

    $(item).listen("y", () => {
      updateItemPosition(itemId, item);
    });

    // Listen for state changes (cooking progress, etc.)
    $(item).listen("itemType", () => {
      updateItemType(itemId, item);
    });

    $(item).listen("cookingProgress", () => {
      updateCookingProgress(itemId, item);
    });

    // Listen for heldBy changes (reconcile optimistic updates)
    $(item).listen("heldBy", () => {
      reconcileItemState(itemId, item);
    });

    $(item).listen("state", () => {
      reconcileItemState(itemId, item);
    });
  });

  $(room.state).items.onRemove((_item: ItemSchema, itemId: string) => {
    console.log("Item removed:", itemId);

    if (!gameWorld) return;
    destroyItemEntity(gameWorld, itemId);
  });
};

const createItemEntity = (world: GameWorld, item: ItemSchema): number => {
  const rapierWorld = getRapierWorld();
  if (!rapierWorld) throw new Error("Rapier world not initialized");

  const eid = addEntity(world);

  addComponent(world, eid, Holdable);
  addComponent(world, eid, Sprite);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Collider);
  addComponent(world, eid, NetworkId);

  // Add type-specific component
  if (item.itemType === "uncooked_patty") {
    addComponent(world, eid, UncookedPatty);
  } else if (item.itemType === "cooked_patty") {
    addComponent(world, eid, CookedPatty);
  }

  // Store network ID as hash of server ID
  NetworkId.id[eid] = hashItemId(item.id);

  // Create sprite
  const textureName =
    item.itemType === "cooked_patty" ? "cooked-patty" : "uncooked-patty";
  const sprite = new Pixi.Sprite(Pixi.Assets.get(textureName));
  sprite.width = TILE_WIDTH;
  sprite.height = TILE_HEIGHT;
  sprite.anchor.set(0.5);
  sprite.x = item.x + TILE_WIDTH / 2;
  sprite.y = item.y + TILE_HEIGHT / 2;
  entityContainer.addChild(sprite);
  Sprite[eid] = sprite;

  // Create physics body
  const bodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(item.x, item.y);
  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  RigidBody[eid] = rigidBody;

  const colliderDesc = Rapier.ColliderDesc.cuboid(
    TILE_WIDTH / 2,
    TILE_HEIGHT / 2
  );
  const collider = rapierWorld.createCollider(colliderDesc, rigidBody);
  Collider[eid] = collider;

  return eid;
};

const destroyItemEntity = (world: GameWorld, itemId: string): void => {
  const eid = serverItemToEntity.get(itemId);
  if (eid === undefined) return;

  const rapierWorld = getRapierWorld();

  // Destroy sprite
  const sprite = Sprite[eid];
  if (sprite) {
    sprite.destroy();
    Sprite[eid] = null;
  }

  // Destroy physics
  const collider = Collider[eid];
  const rigidBody = RigidBody[eid];
  if (collider && rapierWorld) {
    rapierWorld.removeCollider(collider, false);
  }
  if (rigidBody && rapierWorld) {
    rapierWorld.removeRigidBody(rigidBody);
  }
  Collider[eid] = null;
  RigidBody[eid] = null;

  removeEntity(world, eid);
  serverItemToEntity.delete(itemId);
  entityToServerItem.delete(eid);
};

const updateItemPosition = (itemId: string, item: ItemSchema): void => {
  const eid = serverItemToEntity.get(itemId);
  if (eid === undefined) return;

  // Update sprite position
  const sprite = Sprite[eid];
  if (sprite) {
    sprite.x = item.x + TILE_WIDTH / 2;
    sprite.y = item.y + TILE_HEIGHT / 2;
  }

  // Update rigid body position
  const rigidBody = RigidBody[eid];
  if (rigidBody) {
    rigidBody.setTranslation({ x: item.x, y: item.y }, true);
  }
};

const updateItemType = (itemId: string, item: ItemSchema): void => {
  const eid = serverItemToEntity.get(itemId);
  if (eid === undefined || !gameWorld) return;

  // Update sprite texture
  const sprite = Sprite[eid];
  if (sprite) {
    const textureName =
      item.itemType === "cooked_patty" ? "cooked-patty" : "uncooked-patty";
    sprite.texture = Pixi.Assets.get(textureName);
    sprite.tint = 0xffffff; // Reset tint when type changes
  }

  // Update ECS components - swap UncookedPatty <-> CookedPatty
  if (item.itemType === "cooked_patty") {
    removeComponent(gameWorld, eid, UncookedPatty);
    addComponent(gameWorld, eid, CookedPatty);
  } else if (item.itemType === "uncooked_patty") {
    removeComponent(gameWorld, eid, CookedPatty);
    addComponent(gameWorld, eid, UncookedPatty);
  }
};

const updateCookingProgress = (itemId: string, item: ItemSchema): void => {
  const eid = serverItemToEntity.get(itemId);
  if (eid === undefined) return;

  // Apply cooking tint based on progress
  const sprite = Sprite[eid];
  if (!sprite) return;

  if (
    item.cookingProgress > 0 &&
    item.cookingProgress < 1 &&
    item.itemType === "uncooked_patty"
  ) {
    // Lerp from raw to cooked color while cooking
    const UNCOOKED_TINT = 0xffcccc;
    const COOKED_TINT = 0xd4a574;
    sprite.tint = lerpColor(UNCOOKED_TINT, COOKED_TINT, item.cookingProgress);
  } else if (item.cookingProgress === 0 || item.itemType === "cooked_patty") {
    // Reset tint when not cooking or when cooked
    sprite.tint = 0xffffff;
  }
};

const lerpColor = (from: number, to: number, t: number): number => {
  const fromR = (from >> 16) & 0xff;
  const fromG = (from >> 8) & 0xff;
  const fromB = from & 0xff;

  const toR = (to >> 16) & 0xff;
  const toG = (to >> 8) & 0xff;
  const toB = to & 0xff;

  const r = Math.round(fromR + (toR - fromR) * t);
  const g = Math.round(fromG + (toG - fromG) * t);
  const b = Math.round(fromB + (toB - fromB) * t);

  return (r << 16) | (g << 8) | b;
};

const reconcileItemState = (itemId: string, item: ItemSchema): void => {
  reconcileWithServer(itemId, item.x, item.y, item.heldBy);
};

const hashItemId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

// Export helpers for interaction system
export const getEntityForServerItem = (itemId: string): number | undefined => {
  return serverItemToEntity.get(itemId);
};

export const getServerItemForEntity = (eid: number): string | undefined => {
  return entityToServerItem.get(eid);
};

export const getAllServerItemIds = (): string[] => {
  return Array.from(serverItemToEntity.keys());
};
