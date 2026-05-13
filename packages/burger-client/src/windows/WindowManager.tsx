import { useEffect } from "react";
import { eden } from "../eden";
import { useGameStore } from "../store";
import Atlas from "../routes/Atlas";
import Taskbar from "./Taskbar";
import Window from "./Window";
import DebugWindow from "./DebugWindow";
import SpawnWindow from "./SpawnWindow";
import BotsWindow from "./BotsWindow";
import ZonesWindow from "./ZonesWindow";
import TilePickerWindow from "./TilePickerWindow";

// Window IDs are stable strings; treat them like keys in the store.
export const WINDOW_DEBUG = "debug";
export const WINDOW_ATLAS = "atlas";
export const WINDOW_SPAWN = "spawn";
export const WINDOW_BOTS = "bots";
export const WINDOW_ZONES = "zones";
export const WINDOW_TILE_PICKER = "tile-picker";

const showDebug = import.meta.env.DEV;

const WindowManager = () => {
  const user = useGameStore((s) => s.user);
  const registerWindow = useGameStore((s) => s.registerWindow);
  const toggleWindow = useGameStore((s) => s.toggleWindow);
  const setPalette = useGameStore((s) => s.setPalette);
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
      registerWindow(WINDOW_SPAWN, {
        title: "Spawn",
        x: 80,
        y: 80,
        w: 280,
        h: 260,
        open: false,
      });
      registerWindow(WINDOW_BOTS, {
        title: "Bots",
        x: 80,
        y: 80,
        w: 240,
        h: 200,
        open: false,
      });
      registerWindow(WINDOW_ZONES, {
        title: "Zones",
        x: 20,
        y: 60,
        w: 320,
        h: 480,
        open: false,
      });
    }
    // Tile picker is available to admins (taskbar) and non-admins (HUD button
    // in Task 7), so it registers unconditionally for any authenticated user.
    registerWindow(WINDOW_TILE_PICKER, {
      title: "Palette",
      x: 60,
      y: 100,
      w: 380,
      h: 480,
      open: false,
    });
  }, [isAdmin, registerWindow]);

  // Fetch the user's curated palette once they're authenticated. The pixi
  // editor watches the store and rebuilds slots when this lands; the
  // TilePickerWindow uses it to render the "in palette" yellow border.
  // Non-admins are now allowed since palette endpoints were widened in
  // burger-server.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await eden.api.palette.get();
      if (cancelled) return;
      if (error || !data || !("ok" in data) || !data.ok) {
        console.warn("failed to load palette");
        return;
      }
      setPalette(data.ids ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setPalette]);

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
  const taskbarIds = isAdmin
    ? [
        WINDOW_ATLAS,
        WINDOW_SPAWN,
        WINDOW_BOTS,
        WINDOW_ZONES,
        WINDOW_TILE_PICKER,
      ]
    : [];

  return (
    <>
      {showDebug && (
        <Window id={WINDOW_DEBUG}>
          <DebugWindow />
        </Window>
      )}
      {isAdmin && (
        <>
          <Window id={WINDOW_ATLAS}>
            <Atlas />
          </Window>
          <Window id={WINDOW_SPAWN}>
            <SpawnWindow />
          </Window>
          <Window id={WINDOW_BOTS}>
            <BotsWindow />
          </Window>
          <Window id={WINDOW_ZONES}>
            <ZonesWindow />
          </Window>
        </>
      )}
      {user && (
        <Window id={WINDOW_TILE_PICKER}>
          <TilePickerWindow />
        </Window>
      )}
      <Taskbar ids={taskbarIds} />
    </>
  );
};

export default WindowManager;
