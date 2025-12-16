import levelData from "./burger.json";

export type ItemType = "uncooked-patty" | "cooked-patty";

export type EntityInstance = {
  id: string;
  type: string;
  x: number;
  y: number;
  fieldInstances?: Array<{ __identifier: string; __value: unknown }>;
};

export type SurfaceEntityInstance = EntityInstance & {
  stock?: number;
  spawnType?: string;
};

export type LevelData = {
  items: EntityInstance[];
  surfaces: SurfaceEntityInstance[]; // Stoves, Bins, PattyBoxes, OrderWindows
  playerSpawn: { x: number; y: number } | null;
};

export const getRawLevelData = () => levelData;

export const loadLevelData = (): LevelData => {
  const level = levelData.levels[0];

  const entitiesLayer = level.layerInstances.find(
    (layer: { __identifier: string }) => layer.__identifier === "Entities"
  );

  if (!entitiesLayer) {
    throw new Error("Entities layer not found");
  }

  const items: EntityInstance[] = [];
  const surfaces: SurfaceEntityInstance[] = [];
  let playerSpawn: { x: number; y: number } | null = null;

  for (const entity of entitiesLayer.entityInstances) {
    const instance: EntityInstance = {
      id: entity.iid,
      type: entity.__identifier,
      x: entity.__worldX,
      y: entity.__worldY,
      fieldInstances: entity.fieldInstances,
    };

    switch (entity.__identifier) {
      case "Cooked_Patty":
      case "Uncooked_Patty":
        items.push(instance);
        break;
      case "Player":
        playerSpawn = { x: entity.__worldX, y: entity.__worldY };
        break;
      case "Stove":
      case "Bin":
      case "PattyBox":
      case "OrderWindow": {
        // Extract custom fields for surfaces
        const surfaceInstance: SurfaceEntityInstance = { ...instance };

        // Parse field instances for config
        if (entity.fieldInstances) {
          for (const field of entity.fieldInstances) {
            if (field.__identifier === "stock" && typeof field.__value === "number") {
              surfaceInstance.stock = field.__value;
            }
            if (field.__identifier === "spawnType" && typeof field.__value === "string") {
              surfaceInstance.spawnType = field.__value;
            }
          }
        }

        surfaces.push(surfaceInstance);
        break;
      }
    }
  }

  return { items, surfaces, playerSpawn };
};

export const entityTypeToItemType = (entityType: string): ItemType | null => {
  switch (entityType) {
    case "Cooked_Patty":
      return "cooked-patty";
    case "Uncooked_Patty":
      return "uncooked-patty";
    default:
      return null;
  }
};
