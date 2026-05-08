import {
  addComponent,
  addEntity,
  hasComponent,
  removeComponent,
  removeEntity,
} from "bitecs";
import type { Database } from "bun:sqlite";
import type { World } from "./world";
import type { ValidatedPaint } from "./paint-validation";

const isSolid = (type: string): boolean =>
  type === "wall" || type === "counter";

/**
 * Apply a validated paint command:
 * - DB: INSERT/REPLACE/DELETE in `tiles`, append to `tile_edits`.
 * - ECS: add/update/remove the tile entity at (x, y).
 *
 * Caller is responsible for validation, admin gating, and rate limiting.
 */
export const applyPaint = (
  world: World,
  db: Database,
  cmd: ValidatedPaint,
  userId: string,
): void => {
  const { Position, Tile, Networked, Solid } = world.components;
  const { x, y, tileId } = cmd;
  const key = `${x},${y}`;
  const existingEid = world.tilesAtPosition.get(key);
  const oldTileId =
    existingEid !== undefined ? (Tile.type[existingEid] ?? null) : null;

  const tx = db.transaction(() => {
    if (tileId === null) {
      db.run("DELETE FROM tiles WHERE x = ? AND y = ?", [x, y]);
    } else {
      db.run(
        "INSERT INTO tiles (x, y, tile_id) VALUES (?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET tile_id = excluded.tile_id",
        [x, y, tileId],
      );
    }
    db.run(
      "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (?, ?, ?, ?, ?, ?)",
      [x, y, oldTileId, tileId, userId, Date.now()],
    );
  });
  tx();

  if (tileId === null) {
    if (existingEid !== undefined) {
      removeEntity(world, existingEid);
      world.tilesAtPosition.delete(key);
    }
    return;
  }

  const cat = world.catalog.get(tileId);
  if (!cat) {
    // Should never happen — validator confirms catalog membership.
    return;
  }

  if (existingEid !== undefined) {
    Tile.type[existingEid] = tileId;
    if (isSolid(cat.type)) {
      if (!hasComponent(world, existingEid, Solid)) {
        addComponent(world, existingEid, Solid);
      }
    } else {
      if (hasComponent(world, existingEid, Solid)) {
        removeComponent(world, existingEid, Solid);
      }
    }
    return;
  }

  // New entity
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;
  addComponent(world, eid, Tile);
  Tile.type[eid] = tileId;
  if (isSolid(cat.type)) addComponent(world, eid, Solid);
  addComponent(world, eid, Networked);
  world.tilesAtPosition.set(key, eid);
};
