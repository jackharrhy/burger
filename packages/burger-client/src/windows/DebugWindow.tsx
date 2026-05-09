import { useGameStore } from "../store";

const signOut = async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
};

const DebugWindow = () => {
  const metrics = useGameStore((s) => s.metrics);
  const user = useGameStore((s) => s.user);
  const setLag = useGameStore((s) => s.setLag);
  const setJitter = useGameStore((s) => s.setJitter);

  return (
    <div className="debug-window">
      <div className="debug-row">
        <span className="label">Updates/sec</span>
        <span className="value">{metrics.updatesHz}</span>
      </div>
      <div className="debug-row">
        <span className="label">Server tickrate</span>
        <span className="value">{metrics.tickrate}</span>
      </div>
      <div className="debug-row">
        <span className="label">Bytes sent/sec</span>
        <span className="value">{metrics.bytesSentPerSec}</span>
      </div>
      <div className="debug-row">
        <span className="label">Bytes received/sec</span>
        <span className="value">{metrics.bytesReceivedPerSec}</span>
      </div>

      <div className="section-divider" />

      <div className="debug-row">
        <span className="label">Lag</span>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={metrics.lag}
          onChange={(e) => setLag(Number(e.target.value))}
        />
        <span className="value">{metrics.lag}ms</span>
      </div>
      <div className="debug-row">
        <span className="label">Jitter</span>
        <input
          type="range"
          min={0}
          max={500}
          step={1}
          value={metrics.jitter}
          onChange={(e) => setJitter(Number(e.target.value))}
        />
        <span className="value">{metrics.jitter}ms</span>
      </div>

      <div className="section-divider" />

      <div className="debug-row">
        <span className="label">Signed in as</span>
        <span className="value">
          {user?.displayName ?? user?.username ?? "—"}
        </span>
      </div>
      <div className="debug-row">
        <span className="label" />
        <button onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
};

export default DebugWindow;
