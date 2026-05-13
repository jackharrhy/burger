// Stub browser globals so modules that touch `window` at top-level (e.g.
// `eden.ts` reading `window.location.origin`) can be imported in bun:test.
// Tests in this package exercise pure functions only — they never make
// actual network calls — so a minimal shim is fine.
if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = {
    location: {
      origin: "http://localhost",
      protocol: "http:",
      host: "localhost",
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
