import { useEffect, useState } from "react";
import { eden } from "../eden";

const fetchCount = async (): Promise<number> => {
  const { data, error } = await eden.api.bots.get();
  if (error || !data) throw new Error("failed to load bot count");
  return (data as { count: number }).count;
};

const BotsWindow = () => {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [lastReset, setLastReset] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCount()
      .then((c) => !cancelled && setCount(c))
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onReset = async () => {
    setError(null);
    setResetting(true);
    const { data, error: postError } = await eden.api.bots.reset.post();
    setResetting(false);
    if (postError) {
      setError(`reset failed: ${postError.status}`);
      return;
    }
    if (data && "ok" in data && !data.ok) {
      setError(JSON.stringify(data.errors));
      return;
    }
    if (data && "count" in data) setLastReset(data.count ?? 0);
  };

  return (
    <div className="debug-window">
      <div className="debug-row">
        <span className="label">Active bots</span>
        <span className="value">{count ?? "—"}</span>
      </div>

      {error && <div className="atlas-error">{error}</div>}

      <div className="section-divider" />

      <div className="debug-row">
        <button onClick={onReset} disabled={resetting}>
          {resetting ? "resetting…" : "reset to spawn"}
        </button>
      </div>

      {lastReset !== null && (
        <div className="debug-row">
          <span className="label">Last reset</span>
          <span className="value">{lastReset} bots</span>
        </div>
      )}
    </div>
  );
};

export default BotsWindow;
