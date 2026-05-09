import { useGameStore } from "../store";

type Props = {
  // Filter which window IDs appear in the taskbar. Order is significant.
  ids: string[];
};

const Taskbar = ({ ids }: Props) => {
  const windows = useGameStore((s) => s.windows);
  const toggleWindow = useGameStore((s) => s.toggleWindow);

  const visible = ids.map((id) => windows[id]).filter((w) => w !== undefined);
  if (visible.length === 0) return null;

  return (
    <div className="taskbar" role="toolbar" aria-label="Admin tools">
      {visible.map((w) => (
        <button
          key={w.id}
          className={`taskbar-button${w.open ? " taskbar-button-open" : ""}`}
          onClick={() => toggleWindow(w.id)}
        >
          {w.title}
        </button>
      ))}
    </div>
  );
};

export default Taskbar;
