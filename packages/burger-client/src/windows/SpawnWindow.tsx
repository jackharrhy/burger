import { useEffect, useState } from "react";
import { eden } from "../eden";
import { useGameStore, type SpawnZone } from "../store";

const fetchSpawn = async (): Promise<SpawnZone> => {
  const { data, error } = await eden.api.settings.spawn.get();
  if (error || !data) throw new Error("failed to load spawn zone");
  return data as SpawnZone;
};

const numberInput = (
  label: string,
  value: number,
  setter: (n: number) => void,
) => (
  <div className="debug-row">
    <span className="label">{label}</span>
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) setter(Math.round(v));
      }}
    />
  </div>
);

const SpawnWindow = () => {
  const setSpawnDraft = useGameStore((s) => s.setSpawnDraft);

  const [initial, setInitial] = useState<SpawnZone | null>(null);
  const [zone, setZone] = useState<SpawnZone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load current zone on mount and tell the overlay to draw.
  useEffect(() => {
    let cancelled = false;
    fetchSpawn()
      .then((z) => {
        if (cancelled) return;
        setInitial(z);
        setZone(z);
        setSpawnDraft(z);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
      // Clear the overlay when the window unmounts (e.g. closed).
      setSpawnDraft(null);
    };
  }, [setSpawnDraft]);

  // Push every edit into the store so the pixi overlay updates live.
  useEffect(() => {
    if (zone) setSpawnDraft(zone);
  }, [zone, setSpawnDraft]);

  if (initial === null || zone === null) {
    return (
      <div className="debug-window">
        <p>loading…</p>
        {error && <div className="atlas-error">{error}</div>}
      </div>
    );
  }

  const dirty = JSON.stringify(zone) !== JSON.stringify(initial);

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const { data, error: postError } = await eden.api.settings.spawn.post(zone);
    setSaving(false);
    if (postError) {
      setError(`save failed: ${postError.status}`);
      return;
    }
    if (data && "ok" in data && !data.ok) {
      setError(JSON.stringify(data.errors));
      return;
    }
    setInitial(zone);
  };

  const onReset = () => setZone(initial);

  const set = (key: keyof SpawnZone) => (n: number) =>
    setZone((z) => (z ? { ...z, [key]: n } : z));

  return (
    <div className="debug-window">
      {numberInput("x", zone.x, set("x"))}
      {numberInput("y", zone.y, set("y"))}
      {numberInput("w", zone.w, set("w"))}
      {numberInput("h", zone.h, set("h"))}

      {error && <div className="atlas-error">{error}</div>}

      <div className="section-divider" />

      <div className="debug-row">
        <button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "saving…" : "save"}
        </button>
        <button onClick={onReset} disabled={!dirty || saving}>
          reset
        </button>
      </div>
    </div>
  );
};

export default SpawnWindow;
