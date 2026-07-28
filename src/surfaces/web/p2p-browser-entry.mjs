// p2p-browser-entry.mjs — the esbuild entry for public/vendor/p2p.js, the ONE
// shared networking asset every page that joins a world imports at runtime.
// Same arrangement as ./vendor/wink.js: an ESM module, same-origin, one cached
// copy site-wide, imported dynamically by a page's own inline script rather
// than bundled into each page's engine bundle.
//
// A page imports it LAZILY, off the boot path, so networking nobody asked for
// never delays a first answer. The service worker precaches it anyway, which
// is what lets two laptops on a LAN with no internet still invite each other
// on a return visit.
//
// This module re-exports only; every rule lives in the layers below. The
// memory core rides along because p2p-room.mjs merges through appendFacts, and
// this asset therefore holds its own copy of that code separate from the page's
// engine bundle. The two copies operate on the SAME handle object the page
// passes in, and appendFacts rebuilds its lookup index from the payload on
// every mutation, so neither copy can read the other's stale index.
export {
  createP2pRoom,
  PRESENCE_SCOPE,
  ROOM_IDLE,
  ROOM_SHARING,
  ROOM_ANSWERING,
  ROOM_CONNECTING,
  ROOM_CONNECTED,
  ROOM_FAILED,
} from "../../services/p2p-room.mjs";
export { createTransport } from "../../adapters/p2p/webrtc-transport.mjs";
export { generatePeerId, generateWorldId, generateDisplayName } from "../../domain/p2p/peer-id.mjs";
export { chatSyncableFacts, mudSyncableFacts } from "../../domain/p2p/sync-filter.mjs";
export { decodeInviteBlob, encodeInviteBlob } from "../../domain/p2p/wire.mjs";
export {
  latestProvenanceTimestamp,
  isRecentWave,
  latestFact,
  NODE_NAME_PREDICATE,
  WORLD_NAME_PREDICATE,
  WAVED_PREDICATE,
} from "../../domain/p2p/facts.mjs";
