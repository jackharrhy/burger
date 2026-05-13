import { expect, test, describe } from "bun:test";
import { canPaint } from "../src/zones";

const makeState = (
  zones: { id: number; cells: string[]; members: string[] }[],
) => {
  const zonesMap = new Map<
    number,
    { id: number; name: string; cells: Set<string>; members: Set<string> }
  >();
  const cellToZone = new Map<string, number>();
  for (const z of zones) {
    zonesMap.set(z.id, {
      id: z.id,
      name: `z${z.id}`,
      cells: new Set(z.cells),
      members: new Set(z.members),
    });
    for (const c of z.cells) cellToZone.set(c, z.id);
  }
  return { zones: zonesMap, cellToZone };
};

describe("canPaint", () => {
  test("admin always allowed, even outside any zone", () => {
    const w = makeState([]);
    expect(canPaint(w, "alice", 16, 16, true)).toBe(true);
  });

  test("non-admin allowed at cell inside their zone", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["alice"] }]);
    expect(canPaint(w, "alice", 16, 16, false)).toBe(true);
  });

  test("non-admin rejected at cell inside a zone they don't belong to", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["bob"] }]);
    expect(canPaint(w, "alice", 16, 16, false)).toBe(false);
  });

  test("non-admin rejected at cell that isn't in any zone", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["alice"] }]);
    expect(canPaint(w, "alice", 48, 48, false)).toBe(false);
  });

  test("non-admin rejected when zone id is stale (zone deleted between maps)", () => {
    // Simulate: cellToZone references zone 1, but zones map doesn't have 1.
    const zones = new Map<
      number,
      { id: number; name: string; cells: Set<string>; members: Set<string> }
    >();
    const cellToZone = new Map<string, number>([["16,16", 1]]);
    expect(canPaint({ zones, cellToZone }, "alice", 16, 16, false)).toBe(false);
  });
});
