import type { Database } from "bun:sqlite";

export type ZoneRuntime = {
  id: number;
  name: string;
  cells: Set<string>;
  members: Set<string>;
};

export type ZonesState = {
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
};

export const loadZones = (db: Database): ZonesState => {
  const zones = new Map<number, ZoneRuntime>();
  const cellToZone = new Map<string, number>();

  const zoneRows = db.query("SELECT id, name FROM zones").all() as {
    id: number;
    name: string;
  }[];

  for (const z of zoneRows) {
    zones.set(z.id, {
      id: z.id,
      name: z.name,
      cells: new Set(),
      members: new Set(),
    });
  }

  const cellRows = db.query("SELECT zone_id, x, y FROM zone_cells").all() as {
    zone_id: number;
    x: number;
    y: number;
  }[];

  for (const c of cellRows) {
    const zone = zones.get(c.zone_id);
    if (!zone) continue;
    const key = `${c.x},${c.y}`;
    zone.cells.add(key);
    cellToZone.set(key, c.zone_id);
  }

  const memberRows = db
    .query("SELECT zone_id, user_id FROM zone_members")
    .all() as { zone_id: number; user_id: string }[];

  for (const m of memberRows) {
    const zone = zones.get(m.zone_id);
    if (!zone) continue;
    zone.members.add(m.user_id);
  }

  return { zones, cellToZone };
};
