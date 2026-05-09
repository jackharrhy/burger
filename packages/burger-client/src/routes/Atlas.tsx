import { useEffect, useState } from "react";
import AtlasGrid from "../atlas/AtlasGrid";
import BulkFillForm from "../atlas/BulkFillForm";
import CatalogForm from "../atlas/CatalogForm";
import type { AtlasInfo, CatalogEntry } from "../atlas/types";
import { eden } from "../eden";
import { useGameStore } from "../store";

const assignNewIds = (es: CatalogEntry[]): CatalogEntry[] => {
  let nextId = es.reduce((max, e) => (e.id > max ? e.id : max), 0) + 1;
  return es.map((e) => (e.id === 0 ? { ...e, id: nextId++ } : e));
};

const cellLabel = (sx: number, sy: number, tileSize: number) =>
  `tile-${sx / tileSize}x${sy / tileSize}`;

const fetchCatalog = async (): Promise<CatalogEntry[]> => {
  const { data, error } = await eden.api.catalog.get();
  if (error || !data) throw new Error("failed to load catalog");
  return data as CatalogEntry[];
};

const fetchAtlasInfo = async (): Promise<AtlasInfo> => {
  const { data, error } = await eden.api.atlas.get();
  if (error || !data) throw new Error("failed to load atlas info");
  const d = data as { width: number; height: number; url: string };
  return {
    url: d.url,
    width: d.width,
    height: d.height,
    tileSize: 32,
  };
};

const Atlas = () => {
  const user = useGameStore((s) => s.user);
  const palette = useGameStore((s) => s.palette);
  const setPalette = useGameStore((s) => s.setPalette);

  const [initial, setInitial] = useState<CatalogEntry[] | null>(null);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [atlasInfo, setAtlasInfo] = useState<AtlasInfo | null>(null);
  const [selectedSrc, setSelectedSrc] = useState<{
    src_x: number;
    src_y: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = () =>
    Promise.all([fetchCatalog(), fetchAtlasInfo()])
      .then(([c, info]) => {
        setInitial(c);
        setEntries(c);
        setAtlasInfo(info);
      })
      .catch((e: unknown) => {
        setError(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      });

  // Initial load. The window stays mounted while closed (for state preservation),
  // so we only fetch once unless the user explicitly hits Reload.
  useEffect(() => {
    if (initial !== null) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    initial !== null && JSON.stringify(entries) !== JSON.stringify(initial);

  const selected = selectedSrc
    ? (entries.find(
        (e) => e.src_x === selectedSrc.src_x && e.src_y === selectedSrc.src_y,
      ) ?? null)
    : null;

  const onCellSelect = (src: { src_x: number; src_y: number }) => {
    setSelectedSrc(src);
  };

  const onEntryChange = (updated: CatalogEntry | null) => {
    if (!selectedSrc) return;
    setEntries((cur) => {
      const without = cur.filter(
        (e) =>
          !(e.src_x === selectedSrc.src_x && e.src_y === selectedSrc.src_y),
      );
      if (updated === null) return without;
      return [...without, updated];
    });
  };

  const onBulkFill = (type: CatalogEntry["type"]) => {
    if (!atlasInfo) return;
    const taken = new Set(entries.map((e) => `${e.src_x},${e.src_y}`));
    const newEntries: CatalogEntry[] = [];
    for (let sy = 0; sy < atlasInfo.height; sy += atlasInfo.tileSize) {
      for (let sx = 0; sx < atlasInfo.width; sx += atlasInfo.tileSize) {
        if (taken.has(`${sx},${sy}`)) continue;
        newEntries.push({
          id: 0, // sentinel — assignNewIds resolves on save
          type,
          src_x: sx,
          src_y: sy,
          label: cellLabel(sx, sy, atlasInfo.tileSize),
        });
      }
    }
    if (newEntries.length === 0) return;
    setEntries((cur) => [...cur, ...newEntries]);
  };

  const onCellRightClick = async (src: { src_x: number; src_y: number }) => {
    // Find the catalog entry at this cell. If empty or unsaved (id=0), skip.
    const entry = entries.find(
      (e) => e.src_x === src.src_x && e.src_y === src.src_y,
    );
    if (!entry || entry.id === 0) return;

    const exists = palette.includes(entry.id);
    const next = exists
      ? palette.filter((id) => id !== entry.id)
      : palette.length >= 9
        ? palette
        : [...palette, entry.id];
    if (next === palette) return; // hit cap

    // Optimistic update; revert on failure.
    setPalette(next);
    const { data, error: putError } = await eden.api.palette.put({
      ids: next,
    });
    if (putError || !data || ("ok" in data && !data.ok)) {
      setPalette(palette);
      setError(
        `palette save failed: ${putError ? putError.status : "rejected"}`,
      );
    }
  };

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const finalEntries = assignNewIds(entries);
    const { data, error } = await eden.api.catalog.save.post(finalEntries);
    setSaving(false);
    if (error) {
      setError(`save failed: ${error.status}`);
      return;
    }
    if (data && "ok" in data && !data.ok) {
      setError(JSON.stringify(data.errors));
      return;
    }
    void reload();
  };

  const onRename = async (from: number, to: number) => {
    setError(null);
    const { data, error } = await eden.api.catalog.rename.post({ from, to });
    if (error) {
      setError(`rename failed: ${error.status}`);
      return;
    }
    if (data && "ok" in data && !data.ok) {
      setError(JSON.stringify(data.errors));
      return;
    }
    void reload();
  };

  const onReload = () => {
    if (dirty && !confirm("discard unsaved changes?")) return;
    void reload();
  };

  if (initial === null || atlasInfo === null) {
    return (
      <div className="atlas-tool">
        <p>loading catalog…</p>
        {error && <div className="atlas-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="atlas-tool">
      <div className="atlas-toolbar">
        <span className="user">{user?.displayName ?? user?.username}</span>
        <BulkFillForm onFill={onBulkFill} />
        <button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "saving…" : `save ${dirty ? "(unsaved changes)" : ""}`}
        </button>
        <button onClick={onReload}>reload</button>
      </div>
      {error && <div className="atlas-error">{error}</div>}
      <div className="atlas-panes">
        <div className="atlas-grid-pane">
          <AtlasGrid
            atlas={atlasInfo}
            entries={entries}
            selectedSrc={selectedSrc}
            paletteIds={palette}
            onSelect={onCellSelect}
            onCellRightClick={onCellRightClick}
          />
        </div>
        <div className="atlas-form-pane">
          {selectedSrc ? (
            <CatalogForm
              src={selectedSrc}
              entry={selected}
              onChange={onEntryChange}
              onRename={onRename}
            />
          ) : (
            <p>select a cell to edit</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Atlas;
