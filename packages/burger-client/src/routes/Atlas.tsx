import { useEffect, useState } from "react";
import AtlasGrid from "../atlas/AtlasGrid";
import CatalogForm from "../atlas/CatalogForm";
import type { AtlasInfo, CatalogEntry } from "../atlas/types";
import { eden } from "../eden";
import { useGameStore } from "../store";

const assignNewIds = (es: CatalogEntry[]): CatalogEntry[] => {
  let nextId = es.reduce((max, e) => (e.id > max ? e.id : max), 0) + 1;
  return es.map((e) => (e.id === 0 ? { ...e, id: nextId++ } : e));
};

const fetchCatalog = async (): Promise<CatalogEntry[]> => {
  const { data, error } = await eden.api.catalog.get();
  if (error || !data) throw new Error("failed to load catalog");
  return data as CatalogEntry[];
};

const fetchAtlasInfo = async (): Promise<AtlasInfo> => {
  const { data, error } = await eden.api.atlas.get();
  if (error || !data) throw new Error("failed to load atlas info");
  const d = data as { width: number; height: number };
  return {
    url: "/assets/atlas.png",
    width: d.width,
    height: d.height,
    tileSize: 32,
  };
};

const Atlas = () => {
  const user = useGameStore((s) => s.user);

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
            onSelect={onCellSelect}
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
