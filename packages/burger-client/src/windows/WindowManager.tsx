import { useEffect } from "react";
import { useGameStore } from "../store";
import Atlas from "../routes/Atlas";
import Taskbar from "./Taskbar";
import Window from "./Window";
import DebugWindow from "./DebugWindow";

// Window IDs are stable strings; treat them like keys in the store.
export const WINDOW_DEBUG = "debug";
export const WINDOW_ATLAS = "atlas";

const showDebug = import.meta.env.DEV;

const WindowManager = () => {
  const user = useGameStore((s) => s.user);
  const registerWindow = useGameStore((s) => s.registerWindow);
  const toggleWindow = useGameStore((s) => s.toggleWindow);
  const isAdmin = user?.isAdmin === true;

  // Register built-in windows once. registerWindow is idempotent so a remount
  // (StrictMode, fast refresh) preserves user-moved positions.
  useEffect(() => {
    if (showDebug) {
      registerWindow(WINDOW_DEBUG, {
        title: "Debug",
        x: window.innerWidth - 320,
        y: 48,
        w: 300,
        h: 360,
        open: true,
      });
    }
    if (isAdmin) {
      registerWindow(WINDOW_ATLAS, {
        title: "Atlas",
        x: 80,
        y: 80,
        w: Math.min(960, window.innerWidth - 160),
        h: Math.min(640, window.innerHeight - 160),
        open: false,
      });
    }
  }, [isAdmin, registerWindow]);

  // `~` toggles the debug window (dev only).
  useEffect(() => {
    if (!showDebug) return;
    const onKey = (e: KeyboardEvent) => {
      // Avoid hijacking when the user is typing in the atlas form.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        toggleWindow(WINDOW_DEBUG);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleWindow]);

  // Admin taskbar shows admin tools; the debug window is opt-in via the
  // `~` hotkey only and not exposed in the taskbar.
  const taskbarIds = isAdmin ? [WINDOW_ATLAS] : [];

  return (
    <>
      {showDebug && (
        <Window id={WINDOW_DEBUG}>
          <DebugWindow />
        </Window>
      )}
      {isAdmin && (
        <Window id={WINDOW_ATLAS}>
          <Atlas />
        </Window>
      )}
      <Taskbar ids={taskbarIds} />
    </>
  );
};

export default WindowManager;
