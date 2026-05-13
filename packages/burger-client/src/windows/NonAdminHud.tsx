import { useGameStore } from "../store";
import { WINDOW_TILE_PICKER } from "./WindowManager";

// Minimal HUD for non-admins with at least one assigned zone. Today it's
// just a single "Palette" button that opens the TilePickerWindow. The
// status-bar spec will expand this region with health / inventory / etc.
//
// Visible iff:
//   - user is logged in
//   - user is non-admin (admins use the taskbar)
//   - user has at least one paintable cell (myZoneCells is non-empty)
const NonAdminHud = () => {
  const user = useGameStore((s) => s.user);
  const myZoneCells = useGameStore((s) => s.zones.myZoneCells);
  const windows = useGameStore((s) => s.windows);
  const toggleWindow = useGameStore((s) => s.toggleWindow);

  if (!user || user.isAdmin) return null;
  if (myZoneCells.size === 0) return null;

  const tilePickerOpen = windows[WINDOW_TILE_PICKER]?.open ?? false;

  return (
    <div
      className="taskbar"
      role="toolbar"
      aria-label="Player tools"
      style={{ position: "fixed", top: "8px", left: "8px", right: "auto" }}
    >
      <button
        type="button"
        className={`taskbar-button${tilePickerOpen ? " taskbar-button-open" : ""}`}
        onClick={() => toggleWindow(WINDOW_TILE_PICKER)}
      >
        Palette
      </button>
    </div>
  );
};

export default NonAdminHud;
