import { useEffect, useState } from "react";
import { eden } from "../eden";
import { refetchZones, useGameStore } from "../store";

type UserOption = { id: string; display_name: string | null };

const ZonesWindow = () => {
  const list = useGameStore((s) => s.zones.list);
  const selectedId = useGameStore((s) => s.zones.selectedId);
  const setSelectedZone = useGameStore((s) => s.setSelectedZone);

  const [newName, setNewName] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selected = list.find((z) => z.id === selectedId) ?? null;

  // Initial load: zones (admin list + per-zone cells) and the user roster
  // used to render member checkboxes.
  useEffect(() => {
    let cancelled = false;
    void refetchZones().catch(() => {
      /* refetchZones swallows non-admin 403s; nothing else to do */
    });
    void (async () => {
      const { data, error: getError } = await eden.api.users.get();
      if (cancelled) return;
      if (getError || !data || !("users" in data)) {
        setError(`load users failed: ${getError?.status ?? "unknown"}`);
        return;
      }
      setUsers(data.users ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createZone = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const { data, error: postError } = await eden.api.zones.post({ name });
    if (postError) {
      // The server returns 409 on duplicate names; Eden's inferred union may
      // not include it, so compare via a numeric coercion to keep TS happy.
      const status = Number(postError.status);
      setError(
        status === 409 ? "name already taken" : `create failed: ${status}`,
      );
      return;
    }
    if (!data || typeof (data as { id?: unknown }).id !== "number") {
      setError("create failed");
      return;
    }
    const createdId = (data as { id: number }).id;
    setNewName("");
    await refetchZones();
    setSelectedZone(createdId);
  };

  const renameZone = async (id: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === selected?.name) return;
    setError(null);
    const { error: patchError } = await eden.api
      .zones({ id })
      .patch({ name: trimmed });
    if (patchError) {
      const status = Number(patchError.status);
      setError(
        status === 409 ? "name already taken" : `rename failed: ${status}`,
      );
    }
  };

  const deleteZone = async (id: number) => {
    if (!confirm(`Delete zone "${selected?.name}"?`)) return;
    setError(null);
    const { error: delError } = await eden.api.zones({ id }).delete();
    if (delError) {
      setError(`delete failed: ${delError.status}`);
      return;
    }
    setSelectedZone(null);
  };

  const toggleMember = async (userId: string) => {
    if (!selected) return;
    const current = new Set(selected.member_user_ids);
    if (current.has(userId)) current.delete(userId);
    else current.add(userId);
    setError(null);
    const { error: putError } = await eden.api
      .zones({ id: selected.id })
      .members.put({ user_ids: [...current] });
    if (putError) {
      setError(`members update failed: ${putError.status}`);
    }
  };

  return (
    <div className="debug-window">
      <div className="debug-row">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createZone();
          }}
          placeholder="new zone name"
        />
        <button onClick={() => void createZone()}>+ New</button>
      </div>

      {error && <div className="atlas-error">{error}</div>}

      <div className="section-divider" />

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {list.length === 0 && (
          <div className="debug-row">
            <span className="label">no zones yet</span>
          </div>
        )}
        {list.map((z) => (
          <button
            key={z.id}
            onClick={() => setSelectedZone(z.id)}
            className={
              z.id === selectedId
                ? "taskbar-button taskbar-button-open"
                : "taskbar-button"
            }
            style={{ textAlign: "left" }}
          >
            {z.name} ({z.cell_count} cells, {z.member_user_ids.length} members)
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="section-divider" />
          <div className="debug-row">
            <span className="label">name</span>
            <input
              key={selected.id}
              defaultValue={selected.name}
              onBlur={(e) =>
                void renameZone(selected.id, e.currentTarget.value)
              }
            />
          </div>
          <div className="debug-row">
            <span className="label">members</span>
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto" }}>
            {users.map((u) => (
              <label
                key={u.id}
                style={{ display: "block", padding: "2px 4px" }}
              >
                <input
                  type="checkbox"
                  checked={selected.member_user_ids.includes(u.id)}
                  onChange={() => void toggleMember(u.id)}
                />{" "}
                {u.display_name ?? u.id}
              </label>
            ))}
          </div>
          <div className="section-divider" />
          <div className="debug-row">
            <button onClick={() => void deleteZone(selected.id)}>
              delete zone
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ZonesWindow;
