import { useState } from "react";
import type { CatalogEntry } from "./types";

type Props = {
  // Triggered when the admin commits the form. The Atlas route handles the
  // actual filling — this component only owns the type-picker state.
  onFill: (type: CatalogEntry["type"]) => void;
};

const BulkFillForm = ({ onFill }: Props) => {
  const [type, setType] = useState<CatalogEntry["type"]>("floor");

  return (
    <div className="bulk-fill-form">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as CatalogEntry["type"])}
      >
        <option value="floor">floor</option>
        <option value="wall">wall</option>
        <option value="counter">counter</option>
      </select>
      <button onClick={() => onFill(type)}>fill empty cells</button>
    </div>
  );
};

export default BulkFillForm;
