import { create } from "zustand";
import type { Me } from "./types";

export type DebugMetrics = {
  tickrate: number;
  lag: number;
  jitter: number;
  updatesHz: number;
  bytesSentPerSec: number;
  bytesReceivedPerSec: number;
};

export type EditorPublicState = {
  active: boolean;
  selectedTileId: number;
};

// Window manager. Each window registers an entry; open/close/focus/move are
// all session-state (no localStorage). Keeps the manager dumb — windows
// register themselves via WindowManager via `register*` actions; chrome
// reads `windows` map to render.
export type WindowState = {
  id: string;
  title: string;
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type SpawnZone = { x: number; y: number; w: number; h: number };

type GameStore = {
  user: Me | null;
  editor: EditorPublicState | null;
  metrics: DebugMetrics;
  windows: Record<string, WindowState>;
  // The spawn zone the admin is currently editing. When non-null, the pixi
  // SpawnOverlay draws a rectangle at these coords. Set to null when the
  // window closes or after a successful save (the saved value becomes the
  // new server-side truth, no preview needed).
  spawnDraft: SpawnZone | null;
  // Lag/jitter sliders feed back into the live network state. The game's
  // metrics system reads these every tick.
  setLag: (ms: number) => void;
  setJitter: (ms: number) => void;
  setSpawnDraft: (zone: SpawnZone | null) => void;

  setUser: (u: Me | null) => void;
  setEditor: (e: EditorPublicState | null) => void;
  setEditorActive: (active: boolean) => void;
  setSelectedTileId: (id: number) => void;
  setMetrics: (m: Partial<DebugMetrics>) => void;

  registerWindow: (
    id: string,
    init: Omit<WindowState, "id" | "z" | "open"> & { open?: boolean },
  ) => void;
  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  toggleWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  setWindowPos: (id: string, x: number, y: number) => void;
  setWindowSize: (id: string, w: number, h: number) => void;
};

export const useGameStore = create<GameStore>((set) => ({
  user: null,
  editor: null,
  metrics: {
    tickrate: 0,
    lag: 0,
    jitter: 0,
    updatesHz: 0,
    bytesSentPerSec: 0,
    bytesReceivedPerSec: 0,
  },
  windows: {},
  spawnDraft: null,

  setLag: (lag) =>
    set((s) => ({ metrics: { ...s.metrics, lag: Math.max(0, lag) } })),
  setJitter: (jitter) =>
    set((s) => ({ metrics: { ...s.metrics, jitter: Math.max(0, jitter) } })),
  setSpawnDraft: (spawnDraft) => set({ spawnDraft }),

  setUser: (user) => set({ user }),
  setEditor: (editor) => set({ editor }),
  setEditorActive: (active) =>
    set((s) => (s.editor ? { editor: { ...s.editor, active } } : s)),
  setSelectedTileId: (selectedTileId) =>
    set((s) => (s.editor ? { editor: { ...s.editor, selectedTileId } } : s)),
  setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),

  registerWindow: (id, init) =>
    set((s) => {
      // Don't clobber an existing entry — registration is idempotent so
      // a Game.tsx remount under StrictMode keeps the user's window state.
      if (s.windows[id]) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, w) => (w.z > m ? w.z : m),
        0,
      );
      return {
        windows: {
          ...s.windows,
          [id]: {
            id,
            title: init.title,
            open: init.open ?? false,
            x: init.x,
            y: init.y,
            w: init.w,
            h: init.h,
            z: maxZ + 1,
          },
        },
      };
    }),
  openWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, x) => (x.z > m ? x.z : m),
        0,
      );
      return {
        windows: {
          ...s.windows,
          [id]: { ...w, open: true, z: maxZ + 1 },
        },
      };
    }),
  closeWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      return { windows: { ...s.windows, [id]: { ...w, open: false } } };
    }),
  toggleWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, x) => (x.z > m ? x.z : m),
        0,
      );
      return {
        windows: {
          ...s.windows,
          [id]: { ...w, open: !w.open, z: w.open ? w.z : maxZ + 1 },
        },
      };
    }),
  focusWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, x) => (x.z > m ? x.z : m),
        0,
      );
      if (w.z === maxZ) return s; // already on top
      return { windows: { ...s.windows, [id]: { ...w, z: maxZ + 1 } } };
    }),
  setWindowPos: (id, x, y) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      return { windows: { ...s.windows, [id]: { ...w, x, y } } };
    }),
  setWindowSize: (id, w, h) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return s;
      return { windows: { ...s.windows, [id]: { ...win, w, h } } };
    }),
}));
