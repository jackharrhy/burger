import {
  Application,
  Container,
  Sprite as PixiSprite,
  Texture,
  Graphics,
} from "pixi.js";
import { TILE_SIZE } from "burger-shared";
import { sendPaint, type NetworkState } from "./network";
import { useGameStore } from "../store";

export type CatalogEntry = {
  id: number;
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};

export type EditorState = {
  active: boolean;
  selectedTileId: number;
  catalog: CatalogEntry[];
  cursorX: number;
  cursorY: number;
  cursorSprite: PixiSprite | null;
  cursorOutline: Graphics | null;
  paletteContainer: Container | null;
  paletteSlots: Array<{ sprite: PixiSprite; outline: Graphics }>;
  isPainting: boolean;
  paintErase: boolean;
  lastPaintedKey: string | null;
};

const SLOT_SIZE = 40;
const SLOT_PADDING = 4;

const positionPalette = (state: EditorState, app: Application): void => {
  if (!state.paletteContainer) return;
  state.paletteContainer.x = 8;
  state.paletteContainer.y = app.screen.height - SLOT_SIZE - 8;
};

const selectTile = (state: EditorState, tileId: number): void => {
  state.selectedTileId = tileId;
  state.paletteSlots.forEach((slot, i) => {
    slot.outline.visible = state.catalog[i]?.id === tileId;
  });
  useGameStore.getState().setSelectedTileId(tileId);
};

const paintAtCursor = (state: EditorState, network: NetworkState): void => {
  const key = `${state.cursorX},${state.cursorY}`;
  if (key === state.lastPaintedKey) return;
  state.lastPaintedKey = key;
  sendPaint(
    network,
    state.cursorX,
    state.cursorY,
    state.paintErase ? null : state.selectedTileId,
  );
};

export const initEditor = (
  app: Application,
  catalog: CatalogEntry[],
  textures: Record<number, Texture>,
  network: NetworkState,
  mainContainer: Container,
  getCamera: () => { x: number; y: number },
  getZoom: () => number,
): EditorState => {
  const state: EditorState = {
    active: false,
    selectedTileId: catalog[0]?.id ?? 1,
    catalog,
    cursorX: 0,
    cursorY: 0,
    cursorSprite: null,
    cursorOutline: null,
    paletteContainer: null,
    paletteSlots: [],
    isPainting: false,
    paintErase: false,
    lastPaintedKey: null,
  };

  // Cursor preview lives inside the world (mainContainer) so it shows at
  // world coords with the camera transform applied. Anchor 0.5 matches the
  // existing tile sprite convention (Position is the tile center).
  const initialTexture = textures[state.selectedTileId];
  if (initialTexture) {
    const cursorSprite = new PixiSprite(initialTexture);
    cursorSprite.width = TILE_SIZE;
    cursorSprite.height = TILE_SIZE;
    cursorSprite.anchor.set(0.5);
    cursorSprite.alpha = 0.5;
    cursorSprite.visible = false;
    state.cursorSprite = cursorSprite;
    mainContainer.addChild(cursorSprite);
  }

  const outline = new Graphics();
  outline.visible = false;
  state.cursorOutline = outline;
  mainContainer.addChild(outline);

  // Palette: screen-fixed container, drawn on top of the main world.
  const palette = new Container();
  palette.visible = false;
  state.paletteContainer = palette;
  app.stage.addChild(palette);

  catalog.forEach((entry, i) => {
    const tex = textures[entry.id];
    if (!tex) return;
    const slotBg = new Graphics();
    slotBg.rect(0, 0, SLOT_SIZE, SLOT_SIZE).fill({ color: 0x222222 });
    slotBg.x = i * (SLOT_SIZE + SLOT_PADDING);
    slotBg.y = 0;
    slotBg.eventMode = "static";
    slotBg.on("pointertap", () => selectTile(state, entry.id));
    palette.addChild(slotBg);

    const sprite = new PixiSprite(tex);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.x = slotBg.x + (SLOT_SIZE - TILE_SIZE) / 2;
    sprite.y = slotBg.y + (SLOT_SIZE - TILE_SIZE) / 2;
    palette.addChild(sprite);

    const slotOutline = new Graphics();
    slotOutline
      .rect(0, 0, SLOT_SIZE, SLOT_SIZE)
      .stroke({ color: 0xffffff, width: 2 });
    slotOutline.x = slotBg.x;
    slotOutline.y = slotBg.y;
    slotOutline.visible = entry.id === state.selectedTileId;
    palette.addChild(slotOutline);

    state.paletteSlots.push({ sprite, outline: slotOutline });
  });

  positionPalette(state, app);

  // Toggle edit mode with `e` (or Tab).
  window.addEventListener("keydown", (e) => {
    if (e.key === "e" || e.key === "Tab") {
      e.preventDefault();
      state.active = !state.active;
      palette.visible = state.active;
      if (!state.active && state.cursorSprite && state.cursorOutline) {
        state.cursorSprite.visible = false;
        state.cursorOutline.visible = false;
      }
      useGameStore.getState().setEditorActive(state.active);
      return;
    }
    if (state.active) {
      const num = parseInt(e.key, 10);
      if (
        !Number.isNaN(num) &&
        num >= 1 &&
        num <= 9 &&
        state.catalog[num - 1]
      ) {
        selectTile(state, state.catalog[num - 1]!.id);
      }
    }
  });

  // Mouse position → snapped tile-cell center (paint convention is center).
  app.canvas.addEventListener("mousemove", (e) => {
    if (!state.active) return;
    const rect = app.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const cam = getCamera();
    const zoom = getZoom();
    const worldX = (mouseX - app.screen.width / 2) / zoom + cam.x;
    const worldY = (mouseY - app.screen.height / 2) / zoom + cam.y;
    const halfTile = TILE_SIZE / 2;
    state.cursorX = Math.floor(worldX / TILE_SIZE) * TILE_SIZE + halfTile;
    state.cursorY = Math.floor(worldY / TILE_SIZE) * TILE_SIZE + halfTile;
    if (state.isPainting) paintAtCursor(state, network);
  });

  app.canvas.addEventListener("mousedown", (e) => {
    if (!state.active) return;
    e.preventDefault();
    if (e.button === 0) {
      state.isPainting = true;
      state.paintErase = false;
      paintAtCursor(state, network);
    } else if (e.button === 2) {
      state.isPainting = true;
      state.paintErase = true;
      paintAtCursor(state, network);
    }
  });

  window.addEventListener("mouseup", () => {
    state.isPainting = false;
    state.lastPaintedKey = null;
  });

  app.canvas.addEventListener("contextmenu", (e) => {
    if (state.active) e.preventDefault();
  });

  app.canvas.addEventListener("wheel", (e) => {
    if (!state.active) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const idx = state.catalog.findIndex((c) => c.id === state.selectedTileId);
    const next = (idx + dir + state.catalog.length) % state.catalog.length;
    const entry = state.catalog[next];
    if (entry) selectTile(state, entry.id);
  });

  window.addEventListener("resize", () => positionPalette(state, app));

  return state;
};

export const updateEditor = (
  state: EditorState,
  textures: Record<number, Texture>,
): void => {
  if (!state.cursorSprite || !state.cursorOutline) return;
  if (!state.active) {
    state.cursorSprite.visible = false;
    state.cursorOutline.visible = false;
    return;
  }

  // Keep cursor texture in sync with selectedTileId.
  const tex = textures[state.selectedTileId];
  if (tex && state.cursorSprite.texture !== tex) {
    state.cursorSprite.texture = tex;
  }
  // cursorX/Y are the cell center (paint convention). Sprite has anchor 0.5
  // so positioning at the center matches existing tile rendering.
  state.cursorSprite.x = state.cursorX;
  state.cursorSprite.y = state.cursorY;
  state.cursorSprite.visible = true;

  // Outline is a top-left-anchored rect; offset back by half a tile so it
  // surrounds the cell that the cursor sprite occupies.
  const halfTile = TILE_SIZE / 2;
  state.cursorOutline.clear();
  state.cursorOutline
    .rect(
      state.cursorX - halfTile,
      state.cursorY - halfTile,
      TILE_SIZE,
      TILE_SIZE,
    )
    .stroke({ color: 0xffffff, width: 1 });
  state.cursorOutline.visible = true;
};
