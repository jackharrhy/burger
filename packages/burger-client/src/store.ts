import { create } from "zustand";
import type { Me } from "./types";

export type DebugMetrics = {
  tickrate: number;
  lag: number;
  updatesHz: number;
  bytesSentPerSec: number;
  bytesReceivedPerSec: number;
};

export type EditorPublicState = {
  active: boolean;
  selectedTileId: number;
};

type GameStore = {
  user: Me | null;
  editor: EditorPublicState | null;
  metrics: DebugMetrics;

  setUser: (u: Me | null) => void;
  setEditor: (e: EditorPublicState | null) => void;
  setEditorActive: (active: boolean) => void;
  setSelectedTileId: (id: number) => void;
  setMetrics: (m: Partial<DebugMetrics>) => void;
};

export const useGameStore = create<GameStore>((set) => ({
  user: null,
  editor: null,
  metrics: {
    tickrate: 0,
    lag: 0,
    updatesHz: 0,
    bytesSentPerSec: 0,
    bytesReceivedPerSec: 0,
  },

  setUser: (user) => set({ user }),
  setEditor: (editor) => set({ editor }),
  setEditorActive: (active) =>
    set((s) => (s.editor ? { editor: { ...s.editor, active } } : s)),
  setSelectedTileId: (selectedTileId) =>
    set((s) => (s.editor ? { editor: { ...s.editor, selectedTileId } } : s)),
  setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),
}));
