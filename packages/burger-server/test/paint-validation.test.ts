import { expect, test } from "bun:test";
import { validatePaint } from "../src/paint-validation";
import { TILE_SIZE } from "burger-shared";

const world = {
  bounds: { x: 0, y: 0, w: TILE_SIZE * 10, h: TILE_SIZE * 10 },
};
const catalog = new Set([1, 2, 3]);

test("valid paint passes", () => {
  const out = validatePaint(
    { type: "paint", x: 32, y: 64, tileId: 2 },
    world,
    catalog,
  );
  expect(out).toEqual({ x: 32, y: 64, tileId: 2 });
});

test("erase (tileId null) passes", () => {
  const out = validatePaint(
    { type: "paint", x: 32, y: 64, tileId: null },
    world,
    catalog,
  );
  expect(out).toEqual({ x: 32, y: 64, tileId: null });
});

test("rejects non-object", () => {
  expect(validatePaint(null, world, catalog)).toBeNull();
  expect(validatePaint("hi", world, catalog)).toBeNull();
  expect(validatePaint(42, world, catalog)).toBeNull();
});

test("rejects wrong type tag", () => {
  expect(
    validatePaint(
      { type: "input", x: 32, y: 64, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects non-integer coords", () => {
  expect(
    validatePaint(
      { type: "paint", x: 32.5, y: 64, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: 32, y: "64", tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects coords not aligned to TILE_SIZE", () => {
  expect(
    validatePaint(
      { type: "paint", x: 33, y: 64, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: 32, y: 65, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects coords outside bounds (each edge)", () => {
  expect(
    validatePaint(
      { type: "paint", x: -32, y: 0, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: 0, y: -32, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: TILE_SIZE * 10, y: 0, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: 0, y: TILE_SIZE * 10, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("accepts coords at the inside edge", () => {
  expect(
    validatePaint(
      { type: "paint", x: TILE_SIZE * 9, y: TILE_SIZE * 9, tileId: 1 },
      world,
      catalog,
    ),
  ).toEqual({ x: TILE_SIZE * 9, y: TILE_SIZE * 9, tileId: 1 });
});

test("rejects unknown tileId", () => {
  expect(
    validatePaint(
      { type: "paint", x: 0, y: 0, tileId: 999 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects non-integer tileId", () => {
  expect(
    validatePaint(
      { type: "paint", x: 0, y: 0, tileId: 1.5 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: 0, y: 0, tileId: "1" },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("drops unknown fields", () => {
  const out = validatePaint(
    { type: "paint", x: 32, y: 64, tileId: 1, malicious: "data" },
    world,
    catalog,
  );
  expect(out).toEqual({ x: 32, y: 64, tileId: 1 });
});
