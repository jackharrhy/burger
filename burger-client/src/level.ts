import * as Pixi from "pixi.js";
import type { GameEntity } from "./types";
import { LEVEL_DATA, TILE_HEIGHT, TILE_WIDTH } from "./vars";
import { Rapier, world, levelContainer } from "./setup";

export const createLevel = () => {
  const walls: GameEntity[] = [];
  const floors: GameEntity[] = [];

  const startX = 0;
  const startY = 0;

  LEVEL_DATA.forEach((row, rowIndex) => {
    row.split("").forEach((tile, colIndex) => {
      const x = startX + colIndex * TILE_WIDTH;
      const y = startY + rowIndex * TILE_HEIGHT;

      if (tile === "=") {
        const sprite = new Pixi.Sprite(Pixi.Assets.get("red-brick"));
        sprite.width = TILE_WIDTH;
        sprite.height = TILE_HEIGHT;
        sprite.anchor.set(0.5);
        sprite.x = x + TILE_WIDTH / 2;
        sprite.y = y + TILE_HEIGHT / 2;
        levelContainer.addChild(sprite);

        const rigidBodyDesc = Rapier.RigidBodyDesc.fixed().setTranslation(
          x + TILE_WIDTH / 2,
          y + TILE_HEIGHT / 2
        );
        const rigidBody = world.createRigidBody(rigidBodyDesc);

        const colliderDesc = Rapier.ColliderDesc.cuboid(
          TILE_WIDTH / 2,
          TILE_HEIGHT / 2
        );
        const collider = world.createCollider(colliderDesc, rigidBody);

        walls.push({ sprite, body: rigidBody, collider });
      } else if (tile === " ") {
        const sprite = new Pixi.Sprite(Pixi.Assets.get("black-floor"));
        sprite.width = TILE_WIDTH;
        sprite.height = TILE_HEIGHT;
        sprite.anchor.set(0.5);
        sprite.x = x + TILE_WIDTH / 2;
        sprite.y = y + TILE_HEIGHT / 2;
        levelContainer.addChild(sprite);

        floors.push({ sprite });
      }
    });
  });
};
