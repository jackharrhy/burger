import { MapSchema } from "@colyseus/schema";
import { ItemSchema, ItemType } from "@burger-king/shared";
import levelData from "@burger-king/shared/src/burger.json";

interface EntityInstance {
  __identifier: string;
  __worldX: number;
  __worldY: number;
  iid: string;
}

interface LayerInstance {
  __identifier: string;
  entityInstances: EntityInstance[];
}

interface Level {
  layerInstances: LayerInstance[];
}

interface LevelData {
  levels: Level[];
}

export const loadItems = (): MapSchema<ItemSchema> => {
  const items = new MapSchema<ItemSchema>();
  const data = levelData as LevelData;
  const level = data.levels[0];

  const entitiesLayer = level.layerInstances.find(
    (layer) => layer.__identifier === "Entities"
  );

  if (!entitiesLayer) {
    console.warn("Entities layer not found in level data");
    return items;
  }

  for (const entity of entitiesLayer.entityInstances) {
    let itemType: ItemType | null = null;

    switch (entity.__identifier) {
      case "Uncooked_Patty":
        itemType = "uncooked_patty";
        break;
      case "Cooked_Patty":
        itemType = "cooked_patty";
        break;
    }

    if (itemType) {
      const item = new ItemSchema();
      item.id = entity.iid;
      item.itemType = itemType;
      item.x = entity.__worldX;
      item.y = entity.__worldY;
      item.state = "on_counter";
      item.heldBy = "";
      item.cookingProgress = 0;

      items.set(item.id, item);
      console.log(`Loaded item: ${item.itemType} at (${item.x}, ${item.y})`);
    }
  }

  console.log(`Loaded ${items.size} items from level data`);
  return items;
};

