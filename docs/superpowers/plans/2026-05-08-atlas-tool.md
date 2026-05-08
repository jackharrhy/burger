# Atlas Tool Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-app atlas tool at `/atlas`. Admins view atlas.png as a 32×32 grid, edit per-cell catalog metadata, save back to atlas.toml, and renumber catalog ids safely.

**Architecture:** Two new admin-gated POST endpoints (`/api/catalog/save`, `/api/catalog/rename`) on the Elysia server. Pure validators in `catalog-validation.ts`; save logic in `catalog-save.ts` (writes atlas.toml + syncs DB + broadcasts CATALOG_UPDATED). Rename is an atomic SQLite transaction that cascades through `tile_catalog`, `tiles`, `tile_edits`, and the in-memory ECS. Client `/atlas` route is replaced with a real React component using a two-pane layout.

**Tech Stack:** Existing — Elysia 1.4, bun:sqlite, React Router v7 data mode, Eden Treaty, React 19. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-08-atlas-tool-design.md`
**Branch:** `client-react-router-eden` (continues phase 1 work).

---

## File structure (final state, additions only)

| Path | Responsibility |
|---|---|
| `packages/burger-shared/src/const.shared.ts` | Add `MESSAGE_TYPES.CATALOG_UPDATED = 10` |
| `packages/burger-server/src/catalog-validation.ts` | NEW. Pure validator |
| `packages/burger-server/src/catalog-save.ts` | NEW. atlas.toml serialize + DB sync |
| `packages/burger-server/src/catalog-rename.ts` | NEW. Atomic rename transaction |
| `packages/burger-server/src/app.ts` | Add 2 POST routes |
| `packages/burger-server/src/network.server.ts` | Add `broadcastCatalogUpdated(catalog)` helper |
| `packages/burger-server/test/catalog-validation.test.ts` | NEW |
| `packages/burger-server/test/catalog-save.test.ts` | NEW |
| `packages/burger-server/test/catalog-rename.test.ts` | NEW |
| `packages/burger-server/test/catalog-e2e.test.ts` | NEW. End-to-end |
| `packages/burger-client/src/routes/Atlas.tsx` | Replace placeholder |
| `packages/burger-client/src/atlas/AtlasGrid.tsx` | NEW. Grid display |
| `packages/burger-client/src/atlas/CatalogForm.tsx` | NEW. Right-pane form |
| `packages/burger-client/src/atlas/types.ts` | NEW. `CatalogEntry` etc. |
| `packages/burger-client/src/game/network.ts` | Handle `CATALOG_UPDATED` |
| `packages/burger-client/src/router.ts` | `atlasLoader` fetches catalog |
| `packages/burger-client/src/style.css` | Atlas tool styles |

---

## Task 1: Catalog validator (pure functions + tests)

**Files:**
- Create: `packages/burger-server/src/catalog-validation.ts`
- Create: `packages/burger-server/test/catalog-validation.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/burger-server/test/catalog-validation.test.ts
import { expect, test } from "bun:test";
import { validateCatalog } from "../src/catalog-validation";

const ATLAS_W = 192;
const ATLAS_H = 288;

const ok = (label: string) => ({
  id: 1,
  type: "floor" as const,
  src_x: 0,
  src_y: 0,
  label,
});

test("valid single-entry catalog passes", () => {
  const result = validateCatalog([ok("floor")], { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.entries).toHaveLength(1);
});

test("rejects non-array input", () => {
  const result = validateCatalog("not an array" as unknown, { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(false);
});

test("rejects non-integer id", () => {
  const result = validateCatalog([{ ...ok("x"), id: 1.5 }], { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[0]?.field).toContain("id");
});

test("rejects id < 1", () => {
  const result = validateCatalog([{ ...ok("x"), id: 0 }], { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(false);
});

test("rejects unknown type", () => {
  const result = validateCatalog(
    [{ ...ok("x"), type: "lava" as unknown as "floor" }],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects empty label", () => {
  const result = validateCatalog([ok("")], { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(false);
});

test("rejects src_x not aligned to TILE_SIZE", () => {
  const result = validateCatalog(
    [{ ...ok("x"), src_x: 17 }],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects src_x out of atlas bounds", () => {
  const result = validateCatalog(
    [{ ...ok("x"), src_x: ATLAS_W }], // exactly at the edge — invalid
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects duplicate ids", () => {
  const result = validateCatalog(
    [
      { ...ok("a"), id: 1 },
      { ...ok("b"), id: 1, src_x: 32 },
    ],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects duplicate src coords", () => {
  const result = validateCatalog(
    [
      { ...ok("a"), id: 1, src_x: 0, src_y: 0 },
      { ...ok("b"), id: 2, src_x: 0, src_y: 0 },
    ],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("accepts a fully-populated catalog", () => {
  const entries = [
    { id: 1, type: "wall" as const, src_x: 0, src_y: 0, label: "wall" },
    { id: 2, type: "floor" as const, src_x: 32, src_y: 0, label: "floor" },
    { id: 3, type: "counter" as const, src_x: 0, src_y: 32, label: "counter" },
  ];
  const result = validateCatalog(entries, { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/jack/repos/personal/burger
pnpm --filter burger-server test test/catalog-validation.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `catalog-validation.ts`**

```ts
// packages/burger-server/src/catalog-validation.ts
import { TILE_SIZE } from "burger-shared";

export type CatalogEntry = {
  id: number;
  type: "floor" | "wall" | "counter";
  src_x: number;
  src_y: number;
  label: string;
};

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; entries: CatalogEntry[] }
  | { ok: false; errors: ValidationError[] };

const VALID_TYPES = new Set(["floor", "wall", "counter"]);

export const validateCatalog = (
  raw: unknown,
  { atlasW, atlasH }: { atlasW: number; atlasH: number },
): ValidationResult => {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ field: "root", message: "expected array" }] };
  }

  const errors: ValidationError[] = [];
  const seenIds = new Set<number>();
  const seenCoords = new Set<string>();
  const entries: CatalogEntry[] = [];

  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] as Record<string, unknown>;
    const prefix = `entries[${i}]`;

    if (!Number.isInteger(e?.id) || (e.id as number) < 1) {
      errors.push({ field: `${prefix}.id`, message: "must be integer ≥ 1" });
      continue;
    }
    const id = e.id as number;
    if (seenIds.has(id)) {
      errors.push({ field: `${prefix}.id`, message: `duplicate id ${id}` });
      continue;
    }
    seenIds.add(id);

    if (typeof e.type !== "string" || !VALID_TYPES.has(e.type)) {
      errors.push({
        field: `${prefix}.type`,
        message: `must be one of floor, wall, counter`,
      });
      continue;
    }

    if (!Number.isInteger(e.src_x) || (e.src_x as number) < 0) {
      errors.push({ field: `${prefix}.src_x`, message: "must be integer ≥ 0" });
      continue;
    }
    if (!Number.isInteger(e.src_y) || (e.src_y as number) < 0) {
      errors.push({ field: `${prefix}.src_y`, message: "must be integer ≥ 0" });
      continue;
    }
    const src_x = e.src_x as number;
    const src_y = e.src_y as number;
    if (src_x % TILE_SIZE !== 0 || src_y % TILE_SIZE !== 0) {
      errors.push({
        field: `${prefix}.src_x`,
        message: `must be multiple of ${TILE_SIZE}`,
      });
      continue;
    }
    if (src_x + TILE_SIZE > atlasW || src_y + TILE_SIZE > atlasH) {
      errors.push({
        field: `${prefix}.src_x`,
        message: `out of atlas bounds (${atlasW}x${atlasH})`,
      });
      continue;
    }
    const coordKey = `${src_x},${src_y}`;
    if (seenCoords.has(coordKey)) {
      errors.push({
        field: `${prefix}.src_x`,
        message: `duplicate source coords (${src_x},${src_y})`,
      });
      continue;
    }
    seenCoords.add(coordKey);

    if (typeof e.label !== "string" || e.label.length === 0) {
      errors.push({ field: `${prefix}.label`, message: "must be non-empty string" });
      continue;
    }

    entries.push({
      id,
      type: e.type as "floor" | "wall" | "counter",
      src_x,
      src_y,
      label: e.label,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entries };
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter burger-server test test/catalog-validation.test.ts
```

Expected: 11/11 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-server/src/catalog-validation.ts packages/burger-server/test/catalog-validation.test.ts
git commit -m "feat(server): catalog validator"
```

---

## Task 2: Add `MESSAGE_TYPES.CATALOG_UPDATED` constant

**Files:**
- Modify: `packages/burger-shared/src/const.shared.ts`

- [ ] **Step 1: Add the constant**

Edit `packages/burger-shared/src/const.shared.ts`. Find the `MESSAGE_TYPES` object and add `CATALOG_UPDATED`:

```ts
export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  YOUR_EID: 3,
  INPUT: 4,
  GAME_STATE: 5,
  PING: 6,
  PONG: 7,
  PAINT: 8,
  // SoA payload accompanies OBSERVER deltas: ...existing comment unchanged
  SOA: 9,
  // Broadcast when an admin saves or renames a catalog entry. Payload is
  // the new catalog as a JSON array (same shape as GET /api/catalog).
  // Clients refetch and update their local atlas + editor + world.catalog.
  CATALOG_UPDATED: 10,
} as const;
```

- [ ] **Step 2: Verify**

```bash
pnpm --filter burger-shared exec tsc --noEmit
pnpm --filter burger-shared test
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/burger-shared/src/const.shared.ts
git commit -m "feat: add MESSAGE_TYPES.CATALOG_UPDATED"
```

---

## Task 3: catalog-save (writes atlas.toml + syncs DB + broadcasts)

**Files:**
- Create: `packages/burger-server/src/catalog-save.ts`
- Create: `packages/burger-server/test/catalog-save.test.ts`

This task implements the save logic but **doesn't** wire the broadcast yet — that comes in Task 5 once the helper exists in network.server.ts. The save function takes a `broadcast` callback so it's testable without the full server harness.

- [ ] **Step 1: Write failing tests**

```ts
// packages/burger-server/test/catalog-save.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../src/db";
import { saveCatalog, serializeCatalog } from "../src/catalog-save";
import type { CatalogEntry } from "../src/catalog-validation";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
};

const seedCatalog = (db: Database, entries: CatalogEntry[]) => {
  for (const e of entries) {
    db.run(
      "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?)",
      [e.id, e.type, e.src_x, e.src_y, e.label],
    );
  }
};

const tmpToml = () => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-test-"));
  return join(dir, "atlas.toml");
};

test("serializeCatalog produces TOML in id order with header", () => {
  const text = serializeCatalog([
    { id: 2, type: "floor", src_x: 32, src_y: 0, label: "floor" },
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" },
  ]);
  expect(text).toContain("# Tile catalog.");
  // id=1 must come before id=2
  const idx1 = text.indexOf("id = 1");
  const idx2 = text.indexOf("id = 2");
  expect(idx1).toBeGreaterThan(0);
  expect(idx2).toBeGreaterThan(idx1);
});

test("serializeCatalog escapes double quotes in labels", () => {
  const text = serializeCatalog([
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: 'wall "stone"' },
  ]);
  expect(text).toContain('label = "wall \\"stone\\""');
});

test("saveCatalog writes the toml file and syncs tile_catalog rows", async () => {
  const db = setupDb();
  const tomlPath = tmpToml();
  let broadcasted: CatalogEntry[] | null = null;

  const result = await saveCatalog({
    db,
    tomlPath,
    entries: [
      { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
      { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
    ],
    broadcast: (c) => {
      broadcasted = c;
    },
  });

  expect(result.ok).toBe(true);
  // file written
  const text = readFileSync(tomlPath, "utf-8");
  expect(text).toContain("id = 1");
  expect(text).toContain("id = 2");
  // db synced
  const rows = db.query("SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id").all();
  expect(rows).toHaveLength(2);
  // broadcast called
  expect(broadcasted).not.toBeNull();
  expect(broadcasted).toHaveLength(2);
});

test("saveCatalog removes deleted catalog rows when no tiles reference them", async () => {
  const db = setupDb();
  seedCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
  const tomlPath = tmpToml();

  const result = await saveCatalog({
    db,
    tomlPath,
    entries: [{ id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" }],
    broadcast: () => {},
  });

  expect(result.ok).toBe(true);
  const rows = db.query("SELECT id FROM tile_catalog ORDER BY id").all();
  expect(rows).toEqual([{ id: 1 }]);
});

test("saveCatalog rejects deletion of an id with active tiles", async () => {
  const db = setupDb();
  seedCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
  // place a tile referencing id=2
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 2)");
  const tomlPath = tmpToml();
  let broadcasted = false;

  const result = await saveCatalog({
    db,
    tomlPath,
    entries: [{ id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" }],
    broadcast: () => {
      broadcasted = true;
    },
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]?.field).toContain("2"); // mentions the offending id
  }
  // not broadcast on failure
  expect(broadcasted).toBe(false);
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm --filter burger-server test test/catalog-save.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `catalog-save.ts`**

```ts
// packages/burger-server/src/catalog-save.ts
import { writeFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { CatalogEntry, ValidationError } from "./catalog-validation";

const HEADER = `# Tile catalog. Source of truth for what can be painted.
# id is stable forever — never reuse an id, even if you delete a tile.
# type is one of: floor, wall, counter.

`;

const escape = (s: string) => s.replace(/"/g, '\\"');

export const serializeCatalog = (entries: CatalogEntry[]): string => {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  const blocks = sorted.map(
    (e) =>
      `[[tiles]]\nid = ${e.id}\ntype = "${escape(e.type)}"\nsrc_x = ${e.src_x}\nsrc_y = ${e.src_y}\nlabel = "${escape(e.label)}"\n`,
  );
  return HEADER + blocks.join("\n");
};

export type SaveResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export const saveCatalog = async ({
  db,
  tomlPath,
  entries,
  broadcast,
}: {
  db: Database;
  tomlPath: string;
  entries: CatalogEntry[];
  broadcast: (catalog: CatalogEntry[]) => void;
}): Promise<SaveResult> => {
  const newIds = new Set(entries.map((e) => e.id));
  const existingIds = (
    db.query("SELECT id FROM tile_catalog").all() as { id: number }[]
  ).map((r) => r.id);
  const removed = existingIds.filter((id) => !newIds.has(id));

  // Reject removals of ids that have active tile references.
  const blocked: number[] = [];
  for (const id of removed) {
    const row = db
      .query("SELECT COUNT(*) as c FROM tiles WHERE tile_id = ?")
      .get(id) as { c: number };
    if (row.c > 0) blocked.push(id);
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      errors: blocked.map((id) => ({
        field: `entries.removed[${id}]`,
        message: `cannot delete catalog id ${id}: ${db
          .query("SELECT COUNT(*) as c FROM tiles WHERE tile_id = ?")
          .get(id) as { c: number }} tile(s) reference it`,
      })),
    };
  }

  // Apply changes in a transaction.
  const tx = db.transaction(() => {
    // Delete removed ids.
    for (const id of removed) {
      db.run("DELETE FROM tile_catalog WHERE id = ?", [id]);
    }
    // Upsert remaining.
    const upsert = db.prepare(
      "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, src_x = excluded.src_x, src_y = excluded.src_y, label = excluded.label",
    );
    for (const e of entries) {
      upsert.run(e.id, e.type, e.src_x, e.src_y, e.label);
    }
  });
  tx();

  // Write the TOML file.
  writeFileSync(tomlPath, serializeCatalog(entries), "utf-8");

  // Broadcast new catalog.
  broadcast(entries);

  return { ok: true };
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter burger-server test test/catalog-save.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-server/src/catalog-save.ts packages/burger-server/test/catalog-save.test.ts
git commit -m "feat(server): catalog save (toml write + db sync)"
```

---

## Task 4: catalog-rename (atomic id renumber)

**Files:**
- Create: `packages/burger-server/src/catalog-rename.ts`
- Create: `packages/burger-server/test/catalog-rename.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/burger-server/test/catalog-rename.test.ts
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db";
import { renameCatalogId } from "../src/catalog-rename";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  // seed catalog
  db.run("INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (1, 'floor', 0, 0, 'floor')");
  db.run("INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (2, 'wall', 32, 0, 'wall')");
  // seed user (for tile_edits FK)
  db.run("INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES ('u1', 'fid', 'u', 0, 0)");
  // seed tiles + edits referencing id=1
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 1)");
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (48, 16, 1)");
  db.run("INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (16, 16, NULL, 1, 'u1', 0)");
  db.run("INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (48, 16, 1, 2, 'u1', 0)");
  return db;
};

test("renameCatalogId moves catalog row and cascades to tiles + tile_edits", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 1, to: 99 });
  expect(result.ok).toBe(true);

  const cat = db.query("SELECT id FROM tile_catalog ORDER BY id").all();
  expect(cat).toEqual([{ id: 2 }, { id: 99 }]);

  const tiles = db.query("SELECT tile_id FROM tiles ORDER BY x").all();
  expect(tiles).toEqual([{ tile_id: 99 }, { tile_id: 99 }]);

  const edits = db
    .query("SELECT old_tile_id, new_tile_id FROM tile_edits ORDER BY x")
    .all();
  expect(edits).toEqual([
    { old_tile_id: null, new_tile_id: 99 },
    { old_tile_id: 99, new_tile_id: 2 },
  ]);
});

test("renameCatalogId rejects rename to an id that already exists", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 1, to: 2 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[0]?.field).toContain("to");
  // nothing changed
  const cat = db.query("SELECT id FROM tile_catalog ORDER BY id").all();
  expect(cat).toEqual([{ id: 1 }, { id: 2 }]);
});

test("renameCatalogId rejects when source id doesn't exist", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 999, to: 100 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[0]?.field).toContain("from");
});

test("renameCatalogId rejects identical from and to", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 1, to: 1 });
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm --filter burger-server test test/catalog-rename.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `catalog-rename.ts`**

```ts
// packages/burger-server/src/catalog-rename.ts
import type { Database } from "bun:sqlite";
import type { ValidationError } from "./catalog-validation";

export type RenameResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export const renameCatalogId = (
  db: Database,
  { from, to }: { from: number; to: number },
): RenameResult => {
  if (!Number.isInteger(from) || from < 1) {
    return {
      ok: false,
      errors: [{ field: "from", message: "must be integer ≥ 1" }],
    };
  }
  if (!Number.isInteger(to) || to < 1) {
    return {
      ok: false,
      errors: [{ field: "to", message: "must be integer ≥ 1" }],
    };
  }
  if (from === to) {
    return {
      ok: false,
      errors: [{ field: "to", message: "must differ from `from`" }],
    };
  }

  const fromExists =
    (
      db.query("SELECT COUNT(*) as c FROM tile_catalog WHERE id = ?").get(
        from,
      ) as { c: number }
    ).c > 0;
  if (!fromExists) {
    return {
      ok: false,
      errors: [{ field: "from", message: `id ${from} not found` }],
    };
  }
  const toExists =
    (
      db.query("SELECT COUNT(*) as c FROM tile_catalog WHERE id = ?").get(
        to,
      ) as { c: number }
    ).c > 0;
  if (toExists) {
    return {
      ok: false,
      errors: [{ field: "to", message: `id ${to} already in use` }],
    };
  }

  const tx = db.transaction(() => {
    // Update tile_edits first (FK references the catalog id, but old/new can be NULL).
    db.run("UPDATE tile_edits SET old_tile_id = ? WHERE old_tile_id = ?", [
      to,
      from,
    ]);
    db.run("UPDATE tile_edits SET new_tile_id = ? WHERE new_tile_id = ?", [
      to,
      from,
    ]);
    db.run("UPDATE tiles SET tile_id = ? WHERE tile_id = ?", [to, from]);
    db.run("UPDATE tile_catalog SET id = ? WHERE id = ?", [to, from]);
  });
  tx();

  return { ok: true };
};
```

NOTE: SQLite's foreign key checking happens at COMMIT time by default, so updating in the order above (`tile_edits` and `tiles` first, then `tile_catalog`) keeps the cascade clean. If you hit FK errors, swap to use `PRAGMA defer_foreign_keys = ON` for the transaction; bun:sqlite supports this.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter burger-server test test/catalog-rename.test.ts
```

Expected: 4/4 PASS.

If FK errors occur in test 1, wrap the transaction body with `db.run("PRAGMA defer_foreign_keys = ON")` at the start, then `db.run("PRAGMA defer_foreign_keys = OFF")` at the end. Re-test.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-server/src/catalog-rename.ts packages/burger-server/test/catalog-rename.test.ts
git commit -m "feat(server): atomic catalog id rename"
```

---

## Task 5: Wire up the broadcast helper + the two POST routes

**Files:**
- Modify: `packages/burger-server/src/network.server.ts`
- Modify: `packages/burger-server/src/app.ts`

This task ties the validator + save + rename into the running server, plus the broadcast.

- [ ] **Step 1: Add `broadcastCatalogUpdated` to `network.server.ts`**

Find the existing broadcast functions (e.g. `broadcastGameState`). Add this helper near them:

```ts
export const broadcastCatalogUpdated = (
  catalog: { id: number; type: string; src_x: number; src_y: number; label: string }[],
): void => {
  if (playerConnections.size === 0) return;
  const json = JSON.stringify(catalog);
  const payload = textEncoder.encode(json);
  const tagged = new Uint8Array(payload.byteLength + 1);
  tagged[0] = MESSAGE_TYPES.CATALOG_UPDATED;
  tagged.set(payload, 1);
  for (const [ws] of playerConnections) {
    ws.sendBinary(tagged);
  }
  debug("catalog_updated broadcast: %d entries", catalog.length);
};
```

The function uses `MESSAGE_TYPES.CATALOG_UPDATED` (added in Task 2) and the existing `playerConnections`, `textEncoder`, and `debug` symbols already in this file.

- [ ] **Step 2: Add the two POST routes in `app.ts`**

Find the existing `.get("/api/catalog", ...)` route in `packages/burger-server/src/app.ts`. Add the two POST routes immediately after it. Top-of-file imports also need updating.

Add these imports at the top:

```ts
import { t } from "elysia";
import { validateCatalog } from "./catalog-validation";
import { saveCatalog } from "./catalog-save";
import { renameCatalogId } from "./catalog-rename";
import { broadcastCatalogUpdated } from "./network.server";
import { addComponent } from "bitecs"; // already imported? confirm
```

(If some are already imported, don't re-add them.)

Add an admin-check helper near the top of `buildApp`:

```ts
const requireAdmin = ({
  cookieHeader,
}: {
  cookieHeader: string | null;
}): { ok: true; userId: string } | { ok: false } => {
  const sessionId = parseSessionCookie(cookieHeader);
  if (!sessionId) return { ok: false };
  const session = getSession(db, sessionId);
  if (!session) return { ok: false };
  const user = getUserById(db, session.userId);
  if (!user || !user.isAdmin) return { ok: false };
  return { ok: true, userId: user.id };
};
```

Add the two routes (insert after the existing `/api/catalog` GET):

```ts
.post(
  "/api/catalog/save",
  async ({ body, headers, set }) => {
    const auth = requireAdmin({ cookieHeader: headers.cookie ?? null });
    if (!auth.ok) {
      set.status = 403;
      return { ok: false, errors: [{ field: "auth", message: "admin required" }] };
    }

    const validation = validateCatalog(body, {
      atlasW: 192, // matches atlas.png dimensions
      atlasH: 288,
    });
    if (!validation.ok) {
      set.status = 400;
      return { ok: false, errors: validation.errors };
    }

    const tomlPath = "./atlas.toml";
    const result = await saveCatalog({
      db,
      tomlPath,
      entries: validation.entries,
      broadcast: (catalog) => {
        // Update in-memory catalog (the world.catalog is a Map<id, entry>)
        world.catalog.clear();
        world.catalogIds.clear();
        for (const e of catalog) {
          world.catalog.set(e.id, e);
          world.catalogIds.add(e.id);
          world.typeIdToAtlasSrc[e.id] = [e.src_x, e.src_y];
        }
        broadcastCatalogUpdated(catalog);
      },
    });
    if (!result.ok) {
      set.status = 409;
      return { ok: false, errors: result.errors };
    }
    return { ok: true };
  },
  {
    body: t.Array(
      t.Object({
        id: t.Number(),
        type: t.Union([t.Literal("floor"), t.Literal("wall"), t.Literal("counter")]),
        src_x: t.Number(),
        src_y: t.Number(),
        label: t.String(),
      }),
    ),
  },
)
.post(
  "/api/catalog/rename",
  ({ body, headers, set }) => {
    const auth = requireAdmin({ cookieHeader: headers.cookie ?? null });
    if (!auth.ok) {
      set.status = 403;
      return { ok: false, errors: [{ field: "auth", message: "admin required" }] };
    }

    const result = renameCatalogId(db, { from: body.from, to: body.to });
    if (!result.ok) {
      set.status = 409;
      return { ok: false, errors: result.errors };
    }

    // Cascade to in-memory state.
    const cat = world.catalog.get(body.from);
    if (cat) {
      world.catalog.delete(body.from);
      world.catalogIds.delete(body.from);
      world.catalog.set(body.to, { ...cat, id: body.to });
      world.catalogIds.add(body.to);
      delete world.typeIdToAtlasSrc[body.from];
      world.typeIdToAtlasSrc[body.to] = [cat.src_x, cat.src_y];
    }

    // Update existing tile entities in the ECS so their Tile.type matches.
    const { Tile } = world.components;
    for (const [, eid] of world.tilesAtPosition) {
      if (Tile.type[eid] === body.from) {
        Tile.type[eid] = body.to;
        // Mark dirty so the next tick's SoA broadcast carries the field update.
        // markEntityDirty is exported from network.server.ts.
        markEntityDirty(eid);
      }
    }

    // Broadcast the new full catalog.
    const newCatalog = Array.from(world.catalog.values());
    broadcastCatalogUpdated(newCatalog);

    return { ok: true };
  },
  {
    body: t.Object({
      from: t.Number(),
      to: t.Number(),
    }),
  },
)
```

Add `markEntityDirty` to the imports from `./network.server`:

```ts
import {
  ...,
  broadcastCatalogUpdated,
  markEntityDirty,
} from "./network.server";
```

NOTE on `world.catalog`: the type was defined in phase 1's `world.ts` as `Map<number, CatalogEntry>` (where `CatalogEntry` is the local server-side type). The new admin endpoints write into the same Map. If `world.catalog` is currently typed as something narrower (e.g. doesn't expose `clear()`), widen it.

- [ ] **Step 3: Run all server tests**

```bash
pnpm --filter burger-server exec tsc --noEmit
pnpm --filter burger-server test
```

Expected: tsc clean, 75 + 11 + 5 + 4 = 95 tests pass (existing + 11 catalog-validation + 5 catalog-save + 4 catalog-rename).

If the new POST routes don't compile because `world.catalog` doesn't have `.clear()` or some other API, peek at `packages/burger-server/src/world.ts` to see the actual type. If it's `Map<number, CatalogEntry>`, then `.clear()` works. If it's a `Record<number, ...>`, change to `Object.keys(world.catalog).forEach(k => delete world.catalog[Number(k)]);` or refactor world.ts to use a Map.

- [ ] **Step 4: Smoke test**

```bash
timeout 4 pnpm dev:server || true
```

Expected: server starts cleanly.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-server/src/network.server.ts packages/burger-server/src/app.ts
git commit -m "feat(server): /api/catalog/save and /api/catalog/rename routes"
```

---

## Task 6: e2e tests for the routes

**Files:**
- Create: `packages/burger-server/test/catalog-e2e.test.ts`

This task adds end-to-end tests against a real Elysia server with admin/non-admin sessions, mirroring the pattern from `paint-e2e.test.ts`.

- [ ] **Step 1: Write the e2e tests**

```ts
// packages/burger-server/test/catalog-e2e.test.ts
import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { removeEntity } from "bitecs";
import { runMigrations } from "../src/db";
import { initWorld } from "../src/world";
import { createServer, getPlayerConnections } from "../src/network.server";
import { createPlayer } from "../src/players";
import { createSession } from "../src/auth/sessions";
import type { AuthConfig } from "../src/auth/config";

let db: Database;
let world: ReturnType<typeof initWorld>;
let app: ReturnType<typeof createServer>;
let port: number;

const authConfig: AuthConfig = {
  fourmUrl: "http://localhost:8000",
  burgerUrl: "http://localhost:5000",
  clientId: "burger",
  isProduction: false,
};

const setupSession = (database: Database, isAdmin: boolean): string => {
  const userId = isAdmin ? "admin1" : "user1";
  database.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, `fid-${userId}`, userId, userId, isAdmin ? 1 : 0, Date.now()],
  );
  return createSession(database, userId);
};

beforeEach(() => {
  // Run from a fresh tmpdir so atlas.toml writes don't pollute the repo.
  process.chdir(mkdtempSync(join(tmpdir(), "atlas-e2e-")));
  db = new Database(":memory:");
  runMigrations(db);
  // seed atlas.toml-equivalent catalog
  db.run("INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (1, 'wall', 0, 0, 'wall')");
  db.run("INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (2, 'counter', 0, 32, 'counter')");
  db.run("INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (3, 'floor', 32, 0, 'floor')");

  world = initWorld(db);
  port = 5900 + Math.floor(Math.random() * 100);
  app = createServer({
    port,
    world,
    db,
    authConfig,
    onPlayerJoin: (name) => createPlayer(world, name),
    onPlayerLeave: (eid) => removeEntity(world, eid),
  });
});

afterEach(async () => {
  const a = app as unknown as {
    stop?: (force?: boolean) => Promise<unknown>;
    server?: { stop?: (force?: boolean) => unknown };
  };
  const stopPromise = (async () => {
    if (typeof a.stop === "function") await a.stop.call(app, true);
    else if (typeof a.server?.stop === "function") await a.server.stop.call(a.server, true);
  })();
  await Promise.race([
    stopPromise,
    new Promise<void>((r) => setTimeout(r, 500)),
  ]);
  for (const [, c] of getPlayerConnections()) {
    try {
      removeEntity(world, c.eid);
    } catch {}
  }
  getPlayerConnections().clear();
  db.close();
});

const post = async (path: string, body: unknown, sessionId?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers.Cookie = `burger_session=${sessionId}`;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
};

test("non-admin POST /api/catalog/save returns 403", async () => {
  const sess = setupSession(db, false);
  const { status } = await post(
    "/api/catalog/save",
    [{ id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" }],
    sess,
  );
  expect(status).toBe(403);
});

test("admin POST /api/catalog/save accepts valid catalog and updates DB", async () => {
  const sess = setupSession(db, true);
  const newCatalog = [
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall renamed" },
    { id: 2, type: "counter", src_x: 0, src_y: 32, label: "counter" },
    { id: 3, type: "floor", src_x: 32, src_y: 0, label: "floor" },
    { id: 4, type: "floor", src_x: 64, src_y: 0, label: "floor variant" },
  ];
  const { status, data } = await post("/api/catalog/save", newCatalog, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true });
  const rows = db
    .query("SELECT id, label FROM tile_catalog ORDER BY id")
    .all();
  expect(rows).toHaveLength(4);
  expect((rows[0] as any).label).toBe("wall renamed");
});

test("admin POST /api/catalog/save rejects deletion of an id with active tiles", async () => {
  const sess = setupSession(db, true);
  // place a tile referencing id=2
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 2)");
  // try to remove id=2 from catalog
  const newCatalog = [
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" },
    { id: 3, type: "floor", src_x: 32, src_y: 0, label: "floor" },
  ];
  const { status, data } = await post("/api/catalog/save", newCatalog, sess);
  expect(status).toBe(409);
  expect(data).toMatchObject({ ok: false });
});

test("admin POST /api/catalog/rename succeeds and cascades", async () => {
  const sess = setupSession(db, true);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 1)");
  const { status, data } = await post(
    "/api/catalog/rename",
    { from: 1, to: 99 },
    sess,
  );
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true });
  const tile = db.query("SELECT tile_id FROM tiles WHERE x = 16 AND y = 16").get();
  expect(tile).toEqual({ tile_id: 99 });
});

test("admin POST /api/catalog/rename to existing id returns 409", async () => {
  const sess = setupSession(db, true);
  const { status } = await post(
    "/api/catalog/rename",
    { from: 1, to: 2 },
    sess,
  );
  expect(status).toBe(409);
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter burger-server test test/catalog-e2e.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 3: Commit**

```bash
git add packages/burger-server/test/catalog-e2e.test.ts
git commit -m "test(server): catalog save + rename e2e"
```

---

## Task 7: Client atlas tool — types + grid component

**Files:**
- Create: `packages/burger-client/src/atlas/types.ts`
- Create: `packages/burger-client/src/atlas/AtlasGrid.tsx`

This task introduces the grid display component. It's pure UI — no save logic yet.

- [ ] **Step 1: Create `atlas/types.ts`**

```ts
// packages/burger-client/src/atlas/types.ts
export type CatalogEntry = {
  id: number;
  type: "floor" | "wall" | "counter";
  src_x: number;
  src_y: number;
  label: string;
};

export type AtlasInfo = {
  url: string;       // /assets/atlas.png
  width: number;     // 192
  height: number;    // 288
  tileSize: number;  // 32
};

export type DraftEntry = {
  id: number | "new"; // "new" before save assigns a real id
  type: "floor" | "wall" | "counter";
  src_x: number;
  src_y: number;
  label: string;
};
```

- [ ] **Step 2: Create `atlas/AtlasGrid.tsx`**

```tsx
// packages/burger-client/src/atlas/AtlasGrid.tsx
import type { AtlasInfo, CatalogEntry } from "./types";

const TYPE_COLORS: Record<CatalogEntry["type"], string> = {
  floor: "#8aab39",
  wall: "#cc444b",
  counter: "#dba14a",
};

type Props = {
  atlas: AtlasInfo;
  entries: CatalogEntry[];
  selectedSrc: { src_x: number; src_y: number } | null;
  scale?: number; // displayed pixels per source pixel
  onSelect: (src: { src_x: number; src_y: number }) => void;
};

const AtlasGrid = ({ atlas, entries, selectedSrc, scale = 2, onSelect }: Props) => {
  const cellPx = atlas.tileSize * scale;
  const cols = atlas.width / atlas.tileSize;
  const rows = atlas.height / atlas.tileSize;
  const byCoord = new Map<string, CatalogEntry>();
  for (const e of entries) byCoord.set(`${e.src_x},${e.src_y}`, e);

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * atlas.tileSize;
      const sy = r * atlas.tileSize;
      const entry = byCoord.get(`${sx},${sy}`);
      const selected = selectedSrc?.src_x === sx && selectedSrc?.src_y === sy;
      cells.push(
        <div
          key={`${sx},${sy}`}
          className="atlas-cell"
          onClick={() => onSelect({ src_x: sx, src_y: sy })}
          style={{
            position: "absolute",
            left: c * cellPx,
            top: r * cellPx,
            width: cellPx,
            height: cellPx,
            border: selected
              ? "3px solid #fff"
              : entry
                ? `2px solid ${TYPE_COLORS[entry.type]}`
                : "1px dashed #555",
            boxSizing: "border-box",
            cursor: "pointer",
          }}
          title={entry ? `id=${entry.id} ${entry.type} ${entry.label}` : "(empty)"}
        />,
      );
    }
  }

  return (
    <div
      className="atlas-grid"
      style={{
        position: "relative",
        width: atlas.width * scale,
        height: atlas.height * scale,
        backgroundImage: `url(${atlas.url})`,
        backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        imageRendering: "pixelated",
      }}
    >
      {cells}
    </div>
  );
};

export default AtlasGrid;
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter burger-client exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/burger-client/src/atlas/
git commit -m "feat(client): atlas grid component"
```

---

## Task 8: Client atlas tool — catalog form component

**Files:**
- Create: `packages/burger-client/src/atlas/CatalogForm.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/burger-client/src/atlas/CatalogForm.tsx
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
```

- [ ] **Step 2: Verify**

```bash
pnpm --filter burger-client exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/burger-client/src/atlas/CatalogForm.tsx
git commit -m "feat(client): catalog form component"
```

---

## Task 9: Client atlas tool — Atlas route + loader

**Files:**
- Modify: `packages/burger-client/src/routes/Atlas.tsx`
- Modify: `packages/burger-client/src/router.ts`
- Modify: `packages/burger-client/src/style.css`

This task wires everything into a real route with a loader that fetches the catalog and a UI that lets the admin edit and save.

- [ ] **Step 1: Update `atlasLoader` in `router.ts`**

Find the existing `atlasLoader` and modify it to also fetch the catalog:

```ts
const atlasLoader = async () => {
  const user = await fetchMe();
  if (!user) throw redirect("/login");
  if (!user.isAdmin) throw redirect("/");
  const { data: catalog, error } = await eden.api.catalog.get();
  if (error || !catalog) throw new Error("failed to load catalog");
  return { user, catalog };
};
```

- [ ] **Step 2: Replace `Atlas.tsx`**

```tsx
// packages/burger-client/src/routes/Atlas.tsx
import { useState } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import AtlasGrid from "../atlas/AtlasGrid";
import CatalogForm from "../atlas/CatalogForm";
import type { AtlasInfo, CatalogEntry } from "../atlas/types";
import { eden } from "../eden";
import type { Me } from "../types";

type LoaderData = { user: Me; catalog: CatalogEntry[] };

const ATLAS_INFO: AtlasInfo = {
  url: "/assets/atlas.png",
  width: 192,
  height: 288,
  tileSize: 32,
};

const Atlas = () => {
  const { user, catalog: initial } = useLoaderData() as LoaderData;
  const revalidator = useRevalidator();

  const [entries, setEntries] = useState<CatalogEntry[]>(initial);
  const [selectedSrc, setSelectedSrc] = useState<
    { src_x: number; src_y: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(entries) !== JSON.stringify(initial);

  const selected = selectedSrc
    ? entries.find(
        (e) => e.src_x === selectedSrc.src_x && e.src_y === selectedSrc.src_y,
      ) ?? null
    : null;

  const onCellSelect = (src: { src_x: number; src_y: number }) => {
    setSelectedSrc(src);
  };

  const onEntryChange = (updated: CatalogEntry | null) => {
    if (!selectedSrc) return;
    setEntries((cur) => {
      const without = cur.filter(
        (e) =>
          !(e.src_x === selectedSrc.src_x && e.src_y === selectedSrc.src_y),
      );
      if (updated === null) return without;
      return [...without, updated];
    });
  };

  const assignNewIds = (es: CatalogEntry[]): CatalogEntry[] => {
    let nextId = es.reduce((max, e) => (e.id > max ? e.id : max), 0) + 1;
    return es.map((e) => (e.id === 0 ? { ...e, id: nextId++ } : e));
  };

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const finalEntries = assignNewIds(entries);
    const { data, error } = await eden.api.catalog.save.post(finalEntries);
    setSaving(false);
    if (error) {
      setError(`save failed: ${error.status}`);
      return;
    }
    if (data && "ok" in data && !data.ok) {
      setError(JSON.stringify(data.errors));
      return;
    }
    revalidator.revalidate();
  };

  const onRename = async (from: number, to: number) => {
    setError(null);
    const { data, error } = await eden.api.catalog.rename.post({ from, to });
    if (error) {
      setError(`rename failed: ${error.status}`);
      return;
    }
    if (data && "ok" in data && !data.ok) {
      setError(JSON.stringify(data.errors));
      return;
    }
    revalidator.revalidate();
  };

  const onReload = () => {
    if (dirty && !confirm("discard unsaved changes?")) return;
    revalidator.revalidate();
  };

  return (
    <div className="atlas-tool">
      <div className="atlas-toolbar">
        <h1>atlas</h1>
        <span className="user">
          {user.displayName ?? user.username}
        </span>
        <button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "saving…" : `save ${dirty ? "(unsaved changes)" : ""}`}
        </button>
        <button onClick={onReload}>reload</button>
        <Link to="/">back to game</Link>
      </div>
      {error && <div className="atlas-error">{error}</div>}
      <div className="atlas-panes">
        <div className="atlas-grid-pane">
          <AtlasGrid
            atlas={ATLAS_INFO}
            entries={entries}
            selectedSrc={selectedSrc}
            onSelect={onCellSelect}
          />
        </div>
        <div className="atlas-form-pane">
          {selectedSrc ? (
            <CatalogForm
              src={selectedSrc}
              entry={selected}
              onChange={onEntryChange}
              onRename={onRename}
            />
          ) : (
            <p>select a cell to edit</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Atlas;
```

- [ ] **Step 3: Append styles to `style.css`**

```css
.atlas-tool {
  font-family: monospace;
  padding: 1em;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1em;
}

.atlas-toolbar {
  display: flex;
  align-items: center;
  gap: 1em;
}

.atlas-toolbar h1 {
  margin: 0;
}

.atlas-toolbar .user {
  color: #888;
  margin-right: auto;
}

.atlas-error {
  background: #6b2020;
  color: #fff;
  padding: 0.5em 1em;
  border-radius: 4px;
}

.atlas-panes {
  display: flex;
  gap: 2em;
  flex: 1;
  overflow: hidden;
}

.atlas-grid-pane {
  overflow: auto;
}

.atlas-form-pane {
  flex: 1;
  min-width: 24em;
  padding: 1em;
  border: 1px solid #444;
  border-radius: 4px;
}

.catalog-form .form-row {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-bottom: 0.5em;
}

.catalog-form .form-row label {
  display: inline-block;
  min-width: 4em;
  color: #888;
}

.catalog-form input[type="text"],
.catalog-form input[type="number"],
.catalog-form select {
  background: #1a1a1a;
  color: #fff;
  border: 1px solid #444;
  padding: 0.25em 0.5em;
  border-radius: 4px;
}

.catalog-form button {
  background: #222;
  color: #fff;
  border: 1px solid #444;
  padding: 0.25em 0.75em;
  border-radius: 4px;
  cursor: pointer;
}

.catalog-form .delete-button {
  background: #6b2020;
  border-color: #aa3333;
  margin-top: 1em;
}
```

- [ ] **Step 4: Verify**

```bash
cd /Users/jack/repos/personal/burger
pnpm --filter burger-client exec tsc --noEmit
pnpm --filter burger-client build
pnpm fmt:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: tsc clean, build succeeds, fmt clean, lint shows ≤ 2 pre-existing warnings, all tests pass.

- [ ] **Step 5: Smoke test**

```bash
timeout 8 pnpm dev || true
```

Expected: clean startup. (Manual browser testing: visit /atlas as admin; click a cell; edit label; click save; verify the change persists by reloading.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): atlas tool route at /atlas"
```

---

## Task 10: Client — handle CATALOG_UPDATED in the game

**Files:**
- Modify: `packages/burger-client/src/game/network.ts`

This task makes the running game catch up when an admin saves a catalog change in another tab. Without this, a connected player's `assets.tiles` map would have stale textures until they reload.

- [ ] **Step 1: Add the case**

Find the message switch in `game/network.ts` (the WS message handler). After the existing `case MESSAGE_TYPES.SOA:` block, add:

```ts
case MESSAGE_TYPES.CATALOG_UPDATED: {
  debug("catalog_updated received: %d bytes", payload.byteLength);
  const decoder = new TextDecoder();
  const json = decoder.decode(payload);
  const catalog = JSON.parse(json) as Array<{
    id: number;
    type: string;
    src_x: number;
    src_y: number;
    label: string;
  }>;
  // Update the in-memory game state. This needs to walk through:
  //   1. context.assets.tiles — re-key the texture map by new id (rebuild from atlas)
  //   2. context.assets.catalog — replace
  //   3. context.editor (if admin) — update palette
  //
  // To keep this minimal, we delegate to a callback if the caller registered
  // one (the game's startGame wires this up).
  if (network.onCatalogUpdated) {
    network.onCatalogUpdated(catalog);
  }
  break;
}
```

- [ ] **Step 2: Add `onCatalogUpdated` to `NetworkState`**

Find the `NetworkState` type:

```ts
export type NetworkState = {
  socket: WebSocket | null;
  inputSeq: number;
  // ...
};
```

Add the handler:

```ts
export type NetworkState = {
  socket: WebSocket | null;
  inputSeq: number;
  // ...existing fields...
  onCatalogUpdated?: (
    catalog: Array<{
      id: number;
      type: string;
      src_x: number;
      src_y: number;
      label: string;
    }>,
  ) => void;
};
```

- [ ] **Step 3: Wire the handler in `startGame`**

Edit `packages/burger-client/src/game/index.ts`. Find where `context.network` is constructed and add `onCatalogUpdated`:

```ts
network: {
  socket: null,
  inputSeq: 0,
  // ...existing fields...
  onCatalogUpdated: (catalog) => {
    // Update the game's local copy of the catalog and the editor's palette.
    // The catalog is a JSON array; rebuild the runtime maps.
    context.assets.catalog = catalog as typeof context.assets.catalog;
    // Rebuild texture map by re-using existing atlas texture + new src coords.
    const { atlas } = context.assets;
    const Rectangle = (window as unknown as { PIXI?: { Rectangle: any } }).PIXI?.Rectangle;
    // Note: pixi.js's Rectangle is already imported at module scope; we
    // can't easily reach it from here in the closure unless we capture it.
    // Simpler: walk catalog and re-key the existing tile texture map.
    // For tile ids that disappeared, drop the texture. For new ids, build one.
    const oldTiles = context.assets.tiles;
    const newTiles: typeof oldTiles = {};
    for (const e of catalog) {
      const existing = oldTiles[e.id];
      if (
        existing &&
        existing.frame.x === e.src_x &&
        existing.frame.y === e.src_y
      ) {
        newTiles[e.id] = existing;
      } else {
        // new texture for this id (or moved src) — build a fresh one
        // from the atlas.
        const Texture = (existing?.constructor ?? null) as
          | typeof import("pixi.js").Texture
          | null;
        if (Texture && atlas) {
          newTiles[e.id] = new Texture({
            source: atlas.source,
            frame: new (atlas.constructor as any).Rectangle?.(
              e.src_x,
              e.src_y,
              context.assets.tiles[Object.keys(oldTiles)[0] ?? 0]?.frame.width ?? 32,
              context.assets.tiles[Object.keys(oldTiles)[0] ?? 0]?.frame.height ?? 32,
            ),
          });
        }
      }
    }
    context.assets.tiles = newTiles;
    debug("catalog updated locally: %d entries", catalog.length);
  },
},
```

NOTE: the texture rebuild code above is awkward because `Texture` and `Rectangle` need to be imported inline. **Cleaner approach:** import `Texture` and `Rectangle` at the top of `game/index.ts` (probably already imported), then construct directly:

```ts
import { Texture, Rectangle, type TextureSource } from "pixi.js";
// ...

network: {
  // ...existing fields,
  onCatalogUpdated: (catalog) => {
    context.assets.catalog = catalog as typeof context.assets.catalog;
    const newTiles: typeof context.assets.tiles = {};
    for (const e of catalog) {
      newTiles[e.id] = new Texture({
        source: context.assets.atlas.source,
        frame: new Rectangle(e.src_x, e.src_y, TILE_SIZE, TILE_SIZE),
      });
    }
    context.assets.tiles = newTiles;
    debug("catalog updated locally: %d entries", catalog.length);
  },
},
```

`Texture`, `Rectangle`, and `TextureSource` are likely already imported at the top of `game/index.ts` (used in `loadAssets`). `TILE_SIZE` comes from `burger-shared`.

- [ ] **Step 4: Verify**

```bash
pnpm --filter burger-client exec tsc --noEmit
pnpm --filter burger-client build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/burger-client/src/game/
git commit -m "feat(client): handle CATALOG_UPDATED broadcasts in the game"
```

---

## Task 11: Final verification + push

**Files:** none modified

- [ ] **Step 1: Full check**

```bash
cd /Users/jack/repos/personal/burger
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm test
pnpm build-frontend
```

Expected: all clean. lint ≤ 2 pre-existing warnings. test count = 75 server + 11 catalog-validation + 5 catalog-save + 4 catalog-rename + 5 catalog-e2e + 13 shared = 113 tests.

- [ ] **Step 2: Smoke `pnpm dev`**

```bash
timeout 10 pnpm dev || true
```

Expected: clean startup.

- [ ] **Step 3: Push**

```bash
git push
```

The branch is already tracked (`client-react-router-eden`). Phase 2 commits are appended to the existing PR (#8).

- [ ] **Step 4: Add a brief PR comment summarizing phase 2 additions**

```bash
gh pr comment 8 --body "$(cat <<'EOF'
## Phase 2 added: atlas tool

- `POST /api/catalog/save` and `POST /api/catalog/rename` server endpoints (admin-gated, atomic SQLite transactions, broadcasts CATALOG_UPDATED on success).
- New /atlas route with a real two-pane editor (grid view + per-cell form).
- Live updates: connected players' games refresh their tile textures on catalog change.
- 25 new tests (validator, save, rename, e2e).

See `docs/superpowers/specs/2026-05-08-atlas-tool-design.md` for design rationale.
EOF
)"
```

---

## Final state

After all 11 tasks:
- Admins can edit the tile catalog visually at `/atlas`.
- Saves write `atlas.toml` and update the running server's catalog.
- ID renumbering is atomic across `tile_catalog`, `tiles`, `tile_edits`, and the in-memory ECS.
- Connected players see catalog updates live (no reload needed).
- 25 new tests cover the validator, save, rename, and e2e routes.
- All existing tests still pass.
