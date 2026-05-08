export type CatalogEntry = {
  id: number;
  type: "floor" | "wall" | "counter";
  src_x: number;
  src_y: number;
  label: string;
};

export type AtlasInfo = {
  url: string;       // /assets/atlas.png
  width: number;     // 192
  height: number;    // 288
  tileSize: number;  // 32
};

export type DraftEntry = {
  id: number | "new"; // "new" before save assigns a real id
  type: "floor" | "wall" | "counter";
  src_x: number;
  src_y: number;
  label: string;
};
