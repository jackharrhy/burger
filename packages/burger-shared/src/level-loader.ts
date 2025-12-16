import levelData from "./burger.json";

export type ItemType = "uncooked-patty" | "cooked-patty";

export type EntityInstance = {
  id: string;
  type: string;
  x: number;
  y: number;
};

export type LevelData = {
  items: EntityInstance[];
  stoves: EntityInstance[];
  playerSpawn: { x: number; y: number } | null;
  stovePositions: Set<string>; // "x,y"
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
  const stoves: EntityInstance[] = [];
  const stovePositions = new Set<string>();
  let playerSpawn: { x: number; y: number } | null = null;

  for (const entity of entitiesLayer.entityInstances) {
    const instance: EntityInstance = {
      id: entity.iid,
      type: entity.__identifier,
      x: entity.__worldX,
      y: entity.__worldY,
    };

    switch (entity.__identifier) {
      case "Cooked_Patty":
      case "Uncooked_Patty":
        items.push(instance);
        break;
      case "Stove":
        stoves.push(instance);
        stovePositions.add(`${entity.__worldX},${entity.__worldY}`);
        break;
      case "Player":
        playerSpawn = { x: entity.__worldX, y: entity.__worldY };
        break;
    }
  }

  return { items, stoves, playerSpawn, stovePositions };
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
