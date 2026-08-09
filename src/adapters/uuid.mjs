// uuid.mjs — RFC 9562 UUIDv7 (node:crypto ships v4 only). Lifted verbatim from
// chat.mjs so the chat session id, the telemetry invocation id, and the bench
// per-run stamp all share ONE time-sortable implementation (no second copy, no dep).
//
// Built on globalThis.crypto.getRandomValues (Web Crypto — every real browser,
// and Node >=19, well under this package's >=24 floor) rather than
// node:crypto's randomBytes: chat.mjs's runTurn stamps a session id here on
// every turn, and a browser bundle has no node:crypto to import — the
// browser build's own stub throws the moment randomBytes is actually called
// (scripts/lib/browser-bundle.mjs's stubNodeBuiltins), which every strict-
// tier ingest turn news.html's replay/poll/teach paths run through would
// hit. Web Crypto needs no environment branch: it is the same call in both.

/** 16 cryptographically random bytes as a plain Uint8Array. */
function randomBytes16() {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

const toHexByte = (n) => n.toString(16).padStart(2, "0");

/** UUID v7 (RFC 9562): 48-bit big-endian unix-ms timestamp, then version/variant
 *  bits over crypto-random tail — time-sortable, unlike crypto.randomUUID()'s v4. */
export function uuidv7(now = Date.now()) {
  const b = randomBytes16();
  // 48-bit unix-ms timestamp, big-endian, written by hand (no Buffer here).
  for (let i = 0; i < 6; i += 1) b[5 - i] = (now / 2 ** (8 * i)) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, toHexByte).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
