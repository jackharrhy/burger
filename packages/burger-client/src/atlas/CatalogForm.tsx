import { useState } from "react";
import type { CatalogEntry } from "./types";

type Props = {
  src: { src_x: number; src_y: number };
  entry: CatalogEntry | null;
  onChange: (entry: CatalogEntry | null) => void; // null = delete
  onRename: (from: number, to: number) => void;
};

const CatalogForm = ({ src, entry, onChange, onRename }: Props) => {
  const [renameTo, setRenameTo] = useState<string>("");

  if (!entry) {
    // Empty cell — offer to create.
    return (
      <div className="catalog-form">
        <p>
          empty cell at ({src.src_x}, {src.src_y})
        </p>
        <button
          onClick={() =>
            onChange({
              id: 0, // sentinel; resolved on save
              type: "floor",
              src_x: src.src_x,
              src_y: src.src_y,
              label: "new tile",
            })
          }
        >
          create entry
        </button>
      </div>
    );
  }

  return (
    <div className="catalog-form">
      <div className="form-row">
        <label>id</label>
        <span>{entry.id === 0 ? "(new)" : entry.id}</span>
        {entry.id !== 0 && (
          <>
            <input
              type="number"
              placeholder="new id"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              style={{ width: "5em" }}
            />
            <button
              disabled={!renameTo || Number.isNaN(parseInt(renameTo, 10))}
              onClick={() => {
                const to = parseInt(renameTo, 10);
                if (!Number.isNaN(to)) {
                  onRename(entry.id, to);
                  setRenameTo("");
                }
              }}
            >
              renumber
            </button>
          </>
        )}
      </div>

      <div className="form-row">
        <label>type</label>
        <select
          value={entry.type}
          onChange={(e) =>
            onChange({ ...entry, type: e.target.value as CatalogEntry["type"] })
          }
        >
          <option value="floor">floor</option>
          <option value="wall">wall</option>
          <option value="counter">counter</option>
        </select>
      </div>

      <div className="form-row">
        <label>src</label>
        <span>
          ({entry.src_x}, {entry.src_y})
        </span>
      </div>

      <div className="form-row">
        <label>label</label>
        <input
          type="text"
          value={entry.label}
          onChange={(e) => onChange({ ...entry, label: e.target.value })}
        />
      </div>

      <button className="delete-button" onClick={() => onChange(null)}>
        delete entry
      </button>
    </div>
  );
};

export default CatalogForm;
