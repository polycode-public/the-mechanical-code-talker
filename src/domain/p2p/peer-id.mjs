// domain/p2p/peer-id.mjs — pure id/name generation for the P2P layer. No
// network, no DOM; safe to import from both a Node test and a browser
// bundle. World/peer ids are UUIDs, generated client-side and never seen by
// any server. Display names are two words drawn from the same closed-world
// lexicon that grounds every taught fact, so a name a player sees on screen
// is always a real word this build's vocabulary already recognizes.
import { loadLexicon } from "../grammar/lexicon.mjs";

const fallbackId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function generatePeerId() {
  return globalThis.crypto?.randomUUID?.() ?? fallbackId("peer");
}

export function generateWorldId() {
  return globalThis.crypto?.randomUUID?.() ?? fallbackId("world");
}

/** A store's stable node id: 16 lowercase hex characters. A peer id is minted
 *  per connection and a display name is user-chosen and collidable, so neither
 *  keys a node's own assertions across its lifetime; this one is minted once,
 *  the first time a store joins a room, and never regenerated. Hex only, so it
 *  is safe to carry inside a provenance tag beside the `#`, `:` and `@`
 *  separators that tag's parser splits on. */
export function generateNodeId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Two distinct words drawn from the lexicon's own noun list — a mnemonic
 *  label, not a credential. `random` is injectable for deterministic tests;
 *  defaults to Math.random. Callers add a numeric suffix themselves if a
 *  live collision turns up among currently-connected peers — this function
 *  never guesses at uniqueness on its own. */
export function generateDisplayName(random = Math.random) {
  const words = [...loadLexicon().nouns.keys()];
  if (words.length < 2) return "guest-guest";
  const pick = () => words[Math.floor(random() * words.length)];
  const first = pick();
  let second = pick();
  while (second === first) second = pick();
  return `${first}-${second}`;
}
