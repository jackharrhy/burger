import { useState } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import AtlasGrid from "../atlas/AtlasGrid";
import CatalogForm from "../atlas/CatalogForm";
import type { AtlasInfo, CatalogEntry } from "../atlas/types";
import { eden } from "../eden";
import type { Me } from "../types";

type LoaderData = { user: Me; catalog: CatalogEntry[] };

const ATLAS_INFO: AtlasInfo = {
  url: "/assets/atlas.png",
  width: 192,
  height: 288,
  tileSize: 32,
};

const assignNewIds = (es: CatalogEntry[]): CatalogEntry[] => {
  let nextId = es.reduce((max, e) => (e.id > max ? e.id : max), 0) + 1;
  return es.map((e) => (e.id === 0 ? { ...e, id: nextId++ } : e));
};

const Atlas = () => {
  const { user, catalog: initial } = useLoaderData() as LoaderData;
  const revalidator = useRevalidator();

  const [entries, setEntries] = useState<CatalogEntry[]>(initial);
  const [selectedSrc, setSelectedSrc] = useState<{
    src_x: number;
    src_y: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(entries) !== JSON.stringify(initial);

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
    revalidator.revalidate();
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
    revalidator.revalidate();
  };

  const onReload = () => {
    if (dirty && !confirm("discard unsaved changes?")) return;
    revalidator.revalidate();
  };

  return (
    <div className="atlas-tool">
      <div className="atlas-toolbar">
        <h1>atlas</h1>
        <span className="user">{user.displayName ?? user.username}</span>
        <button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "saving…" : `save ${dirty ? "(unsaved changes)" : ""}`}
        </button>
        <button onClick={onReload}>reload</button>
        <Link to="/">back to game</Link>
      </div>
      {error && <div className="atlas-error">{error}</div>}
      <div className="atlas-panes">
        <div className="atlas-grid-pane">
          <AtlasGrid
            atlas={ATLAS_INFO}
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
