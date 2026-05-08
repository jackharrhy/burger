import type { InputCmd } from "burger-shared";

export type ValidatedInput = InputCmd;

/**
 * Validates an arbitrary JSON-decoded message into a trusted InputCmd, or
 * returns null if the message is malformed, replayed, or not an input.
 *
 * - Reject non-objects, wrong type tags, non-integer seq, replayed seq.
 * - Coerce all directional/interact fields to booleans (so a malicious client
 *   can't smuggle non-boolean truthy values).
 * - Drop unknown fields (only the known ones survive into the returned shape).
 */
export const validateInput = (
  raw: unknown,
  lastSeq: number,
): ValidatedInput | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "input") return null;
  if (typeof r.seq !== "number" || !Number.isInteger(r.seq) || r.seq < 0) return null;
  if (r.seq <= lastSeq) return null;
  return {
    seq: r.seq,
    up: !!r.up,
    down: !!r.down,
    left: !!r.left,
    right: !!r.right,
    interact: !!r.interact,
  };
};
