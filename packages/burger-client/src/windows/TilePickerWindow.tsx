import { useEffect, useState } from "react";
import { eden } from "../eden";
import { useGameStore } from "../store";
import type { AtlasInfo, CatalogEntry } from "../atlas/types";

const MAX_PALETTE = 9;

// Flat catalog grid. Right-click toggles palette membership (capped at 9).
// Used by both admins (via taskbar) and non-admins (via the HUD button).
// The atlas image + catalog rows are fetched on first open; the palette
// itself lives in the global store so changes propagate to the pixi editor.
const TilePickerWindow = () => {
  const palette = useGameStore((s) => s.palette);
  const setPalette = useGameStore((s) => s.setPalette);

  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [atlasInfo, setAtlasInfo] = useState<AtlasInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [catRes, atlasRes] = await Promise.all([
          eden.api.catalog.get(),
          eden.api.atlas.get(),
        ]);
        if (cancelled) return;
        if (catRes.error || !catRes.data) {
          setError(`load catalog failed: ${catRes.error?.status ?? "unknown"}`);
          return;
        }
        if (atlasRes.error || !atlasRes.data) {
          setError(`load atlas failed: ${atlasRes.error?.status ?? "unknown"}`);
          return;
        }
        const atlasData = atlasRes.data as {
          width: number;
          height: number;
          url: string;
        };
        setCatalog(catRes.data as CatalogEntry[]);
        setAtlasInfo({
          url: atlasData.url,
          width: atlasData.width,
          height: atlasData.height,
          tileSize: 32,
        });
      } catch (e) {
        if (cancelled) return;
        setError(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePalette = async (id: number) => {
    const exists = palette.includes(id);
    const next = exists
      ? palette.filter((x) => x !== id)
      : palette.length >= MAX_PALETTE
        ? palette
        : [...palette, id];
    if (next === palette) {
      // Hit the cap. Surface a one-shot error so the user sees why nothing
      // happened; cleared on the next successful toggle.
      setError(`palette full (max ${MAX_PALETTE})`);
      return;
    }
    setError(null);
    // Optimistic update; revert on server rejection.
    setPalette(next);
    const { data, error: putError } = await eden.api.palette.put({ ids: next });
    if (putError || !data || ("ok" in data && !data.ok)) {
      setPalette(palette);
      setError(
        `palette save failed: ${putError ? putError.status : "rejected"}`,
      );
    }
  };

  if (error && !catalog) {
    return (
      <div style={{ padding: "8px" }}>
        <div style={{ color: "#c33", fontSize: "12px" }}>{error}</div>
      </div>
    );
  }

  if (!catalog || !atlasInfo) {
    return (
      <div style={{ padding: "8px", fontSize: "12px", color: "#888" }}>
        loading catalog…
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: "12px", color: "#aaa" }}>
        Right-click a tile to add/remove from your palette ({palette.length}/
        {MAX_PALETTE})
      </div>
      {error && <div style={{ color: "#c33", fontSize: "12px" }}>{error}</div>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 64px)",
          gap: "8px",
          overflowY: "auto",
          flex: 1,
          alignContent: "start",
        }}
      >
        {catalog.map((entry) => {
          const inPalette = palette.includes(entry.id);
          return (
            <div
              key={entry.id}
              onContextMenu={(e) => {
                e.preventDefault();
                void togglePalette(entry.id);
              }}
              style={{
                width: "64px",
                cursor: "context-menu",
                border: inPalette ? "2px solid #ffd966" : "2px solid #333",
                padding: "2px",
                boxSizing: "border-box",
                userSelect: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
              }}
              title={entry.label}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  imageRendering: "pixelated",
                  backgroundImage: `url(${atlasInfo.url})`,
                  backgroundPosition: `-${entry.src_x}px -${entry.src_y}px`,
                  backgroundRepeat: "no-repeat",
                }}
              />
              <div
                style={{
                  fontSize: "10px",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  width: "100%",
                  color: "#ccc",
                }}
              >
                {entry.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TilePickerWindow;
