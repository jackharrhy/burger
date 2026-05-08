import { expect, test } from "bun:test";
import { validateInput } from "../src/input-validation";

test("valid input passes and returns trusted shape", () => {
  expect(
    validateInput(
      {
        type: "input",
        seq: 1,
        up: true,
        down: false,
        left: false,
        right: false,
        interact: false,
      },
      0,
    ),
  ).toEqual({
    seq: 1,
    up: true,
    down: false,
    left: false,
    right: false,
    interact: false,
  });
});

test("rejects non-object input", () => {
  expect(validateInput(null, -1)).toBeNull();
  expect(validateInput(undefined, -1)).toBeNull();
  expect(validateInput("hi", -1)).toBeNull();
  expect(validateInput(42, -1)).toBeNull();
  expect(validateInput(true, -1)).toBeNull();
});

test("rejects wrong type tag", () => {
  expect(validateInput({ type: "signal", seq: 1 }, -1)).toBeNull();
  expect(validateInput({ type: undefined, seq: 1 }, -1)).toBeNull();
  expect(validateInput({ seq: 1 }, -1)).toBeNull();
});

test("rejects missing or non-integer seq", () => {
  expect(validateInput({ type: "input" }, -1)).toBeNull();
  expect(validateInput({ type: "input", seq: "1" }, -1)).toBeNull();
  expect(validateInput({ type: "input", seq: 1.5 }, -1)).toBeNull();
  expect(validateInput({ type: "input", seq: -1 }, -1)).toBeNull();
  expect(validateInput({ type: "input", seq: NaN }, -1)).toBeNull();
  expect(validateInput({ type: "input", seq: Infinity }, -1)).toBeNull();
});

test("rejects replayed or stale seq", () => {
  expect(validateInput({ type: "input", seq: 5 }, 5)).toBeNull();
  expect(validateInput({ type: "input", seq: 4 }, 5)).toBeNull();
  expect(validateInput({ type: "input", seq: 0 }, 5)).toBeNull();
});

test("coerces non-boolean directional fields to booleans", () => {
  const out = validateInput(
    { type: "input", seq: 1, up: 1, down: "x", left: null, right: 0 },
    0,
  );
  expect(out?.up).toBe(true);
  expect(out?.down).toBe(true);
  expect(out?.left).toBe(false);
  expect(out?.right).toBe(false);
});

test("drops unknown fields from the returned shape", () => {
  const out = validateInput(
    { type: "input", seq: 1, up: true, malicious: "data", _proto_: {} },
    0,
  );
  expect(out).toEqual({
    seq: 1,
    up: true,
    down: false,
    left: false,
    right: false,
    interact: false,
  });
});
