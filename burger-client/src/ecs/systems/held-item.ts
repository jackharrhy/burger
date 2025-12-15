import {
  Position,
  FacingDirection,
  HeldBy,
  Sprite,
  RigidBody,
} from "../components";
import type { GameWorld } from "../world";
import { PLAYER_SIZE, TILE_WIDTH, TILE_HEIGHT } from "../../vars";
import { getPlayerHeldEntity } from "./interaction";

export const heldItemSystem = (_world: GameWorld): void => {
  const heldEntity = getPlayerHeldEntity();
  if (heldEntity === null) return;

  const holderEid = HeldBy.holder[heldEntity];
  if (holderEid === 0) return;

  const interactionPos = {
    x: Position.x[holderEid] + FacingDirection.x[holderEid] * PLAYER_SIZE,
    y: Position.y[holderEid] + FacingDirection.y[holderEid] * PLAYER_SIZE,
  };

  const rigidBody = RigidBody[heldEntity];
  if (rigidBody) {
    rigidBody.setTranslation(interactionPos, true);
  }

  Position.x[heldEntity] = interactionPos.x;
  Position.y[heldEntity] = interactionPos.y;

  const sprite = Sprite[heldEntity];
  if (sprite) {
    sprite.x = interactionPos.x + TILE_WIDTH / 2;
    sprite.y = interactionPos.y + TILE_HEIGHT / 2;
  }
};
