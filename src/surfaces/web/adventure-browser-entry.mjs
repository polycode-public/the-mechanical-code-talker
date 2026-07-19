// adventure-browser-entry.mjs — the esbuild entry for the adventure's
// full-screen/home-page pages (public/adventure-browser.bundle.js, built by
// scripts/build-adventure-bundle.mjs), mirroring
// spider-fly-browser-entry.mjs's own session-factory shape.
//
// Unlike spider-fly's board, Ashcombe Hall's own facts+rules cannot be
// regenerated in-browser from a pure JS module — its canonical definition is
// a Node-only JSONL corpus source, read through an fs/gzip provider the
// browser cannot run. So this session takes the world as data
// (`worldPayload`, `{ name, facts, rules, opening }`), embedded into the page
// at build time by scripts/build-demo-site.mjs's own read through the real
// worlds-pack provider (see adventure-viz.mjs's header for the full
// rationale) — the bootstrap below then just appends it, exactly the shape
// openAdventure() itself writes for a real chat session.
//
// This session exposes ONLY a raw autoplay tick and a read-only snapshot —
// no chat dock. Every state-changing command adventure.mjs's own
// runWorldCommand issues (go/take/open/...) already re-narrates itself
// through the extractive completions digest on every turn (the
// "auto-relook"), so this bundle carries the same wink-nlp/completions
// dependency chain chat.mjs's own runTurn does; a second, lighter path was
// not available to duck under it. Nothing here calls runTurn, though — the
// one entry point exercised is adventureTurn itself, via
// adventure-autoplay.mjs, which is the "auto-play is a caller of the
// existing interpreter, never a second one" contract this whole feature
// rests on.
import {
  createInMemoryStore, appendFacts, appendRule, loadMemory, readFactRows,
} from "../../adapters/memory/core.mjs";
import { foldWorldState, worldDigestRows } from "../../services/adventure.mjs";
import { runAdventureAutoplayTick } from "../../services/adventure-autoplay.mjs";
import { resolveSpriteForClass, SPRITE_REGISTRY } from "../../domain/sprite-map.mjs";

/** A live in-memory adventure this page's ticker drives one auto-play tick
 *  at a time. Returns `{ memoryDir, autoplayTick, snapshot }`.
 *  `worldPayload.facts`/`.rules` seed the store exactly the way
 *  openAdventure() itself does for a real session; `planHolder.state` is set
 *  the same way, so adventureTurn treats every subsequent call as a live,
 *  already-open world rather than a fresh opening line. */
export async function createAdventureSession(worldPayload) {
  const memoryDir = createInMemoryStore();
  const tag = `world:${worldPayload.name}`;
  await appendFacts(memoryDir, worldPayload.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of worldPayload.rules) {
    await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }

  const planHolder = { state: { adventure: { world: worldPayload.name } } };
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  let exposedRoomIds = new Set();
  const openingRows = readFactRows(await loadMemory(memoryDir));
  const openingHere = foldWorldState(openingRows).placements.get("player")?.object ?? null;
  if (openingHere) exposedRoomIds = new Set([openingHere]);

  return {
    memoryDir,

    /** One auto-play tick: infer the goal, execute exactly one move through
     *  adventureTurn (adventure-autoplay.mjs's own contract), thread the
     *  exposed-room set forward. Returns runAdventureAutoplayTick's own
     *  `{ turn, goal, plan, done, stalled }` unmodified. */
    async autoplayTick() {
      const result = await runAdventureAutoplayTick(memoryDir, {
        exposedRoomIds, planHolder, sessionId, env: {},
      });
      exposedRoomIds = result.exposedRoomIds;
      return result;
    },

    /** A read-only fold of the current room — no engine advance — for the
     *  page's own redraw after boot and after every tick. */
    async snapshot() {
      const rows = readFactRows(await loadMemory(memoryDir));
      const state = foldWorldState(rows);
      const here = state.placements.get("player")?.object ?? null;
      return { rows, state, here, turn: state.turnCount };
    },
  };
}

// Re-exported so the page's own rendering script (adventure-viz.mjs) never
// has to duplicate sprite resolution or the digest reader — the same posture
// spider-fly-browser-entry.mjs's own globalThis.tmctSpiderFly re-export takes.
globalThis.tmctAdventure = {
  createAdventureSession, resolveSpriteForClass, SPRITE_REGISTRY, worldDigestRows,
};
