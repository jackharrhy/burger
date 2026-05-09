import type { ReactNode } from "react";
import { Rnd } from "react-rnd";
import { useGameStore } from "../store";

type Props = {
  id: string;
  children: ReactNode;
};

const TITLE_BAR_HEIGHT = 28;

const Window = ({ id, children }: Props) => {
  const win = useGameStore((s) => s.windows[id]);
  const closeWindow = useGameStore((s) => s.closeWindow);
  const focusWindow = useGameStore((s) => s.focusWindow);
  const setWindowPos = useGameStore((s) => s.setWindowPos);
  const setWindowSize = useGameStore((s) => s.setWindowSize);

  if (!win || !win.open) return null;

  return (
    <Rnd
      className="window"
      style={{ zIndex: win.z }}
      position={{ x: win.x, y: win.y }}
      size={{ width: win.w, height: win.h }}
      bounds="window"
      minWidth={200}
      minHeight={TITLE_BAR_HEIGHT * 2}
      dragHandleClassName="window-titlebar"
      cancel=".window-close-button"
      onMouseDown={() => focusWindow(id)}
      onDragStop={(_, d) => setWindowPos(id, d.x, d.y)}
      onResizeStop={(_, __, ref, ___, position) => {
        setWindowSize(id, ref.offsetWidth, ref.offsetHeight);
        setWindowPos(id, position.x, position.y);
      }}
    >
      <div className="window-titlebar">
        <span className="window-title">{win.title}</span>
        <button
          className="window-close-button"
          aria-label={`Close ${win.title}`}
          onClick={(e) => {
            e.stopPropagation();
            closeWindow(id);
          }}
          // Keep mousedown from triggering drag focus; we still want the
          // click to close even while the window is being dragged.
          onMouseDown={(e) => e.stopPropagation()}
        >
          ×
        </button>
      </div>
      <div className="window-body">{children}</div>
    </Rnd>
  );
};

export default Window;
