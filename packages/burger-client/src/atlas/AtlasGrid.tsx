import type { AtlasInfo, CatalogEntry } from "./types";

const TYPE_COLORS: Record<CatalogEntry["type"], string> = {
  floor: "#8aab39",
  wall: "#cc444b",
  counter: "#dba14a",
};

type Props = {
  atlas: AtlasInfo;
  entries: CatalogEntry[];
  selectedSrc: { src_x: number; src_y: number } | null;
  scale?: number; // displayed pixels per source pixel
  onSelect: (src: { src_x: number; src_y: number }) => void;
};

const AtlasGrid = ({ atlas, entries, selectedSrc, scale = 2, onSelect }: Props) => {
  const cellPx = atlas.tileSize * scale;
  const cols = atlas.width / atlas.tileSize;
  const rows = atlas.height / atlas.tileSize;
  const byCoord = new Map<string, CatalogEntry>();
  for (const e of entries) byCoord.set(`${e.src_x},${e.src_y}`, e);

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * atlas.tileSize;
      const sy = r * atlas.tileSize;
      const entry = byCoord.get(`${sx},${sy}`);
      const selected = selectedSrc?.src_x === sx && selectedSrc?.src_y === sy;
      cells.push(
        <div
          key={`${sx},${sy}`}
          className="atlas-cell"
          onClick={() => onSelect({ src_x: sx, src_y: sy })}
          style={{
            position: "absolute",
            left: c * cellPx,
            top: r * cellPx,
            width: cellPx,
            height: cellPx,
            border: selected
              ? "3px solid #fff"
              : entry
                ? `2px solid ${TYPE_COLORS[entry.type]}`
                : "1px dashed #555",
            boxSizing: "border-box",
            cursor: "pointer",
          }}
          title={entry ? `id=${entry.id} ${entry.type} ${entry.label}` : "(empty)"}
        />,
      );
    }
  }

  return (
    <div
      className="atlas-grid"
      style={{
        position: "relative",
        width: atlas.width * scale,
        height: atlas.height * scale,
        backgroundImage: `url(${atlas.url})`,
        backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        imageRendering: "pixelated",
      }}
    >
      {cells}
    </div>
  );
};

export default AtlasGrid;
