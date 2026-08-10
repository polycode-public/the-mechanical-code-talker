// services/chat-session.mjs — the session layer over chat.mjs's pure turn
// engine: repo/config resolution, the one-time graph load, the transcript
// log + structured sidecar streams, the read-time graph upsert, the
// first-run corpus seed bootstrap, and the interactive readline shell.
// Everything that touches the filesystem, the process, or a TTY for a chat
// session lives here; chat.mjs itself (runTurn, the fact engine) carries no
// node:fs/child_process/os/readline imports, so a library or browser caller
// can run turns against an in-memory store with no session side effects.
//
// createSession(…) is the SESSION SINK every shell shares (runChat's
// readline loop below, src/surfaces/tui/app.mjs's Ink shell). chat.mjs re-exports
// createSession/runChat and the session constants so existing import sites
// keep working.

import { join, resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { loadConfig, DEFAULT_GRAPH_REL } from "../adapters/config.mjs";
import { resolveRuntimeConfig } from "./cli-args.mjs";
import { parseEntities } from "../domain/codegraph.mjs";
import { SESSIONS_DIR_REL, appendSessionToGraph } from "./sessions.mjs";
import { uuidv7 } from "../adapters/uuid.mjs";
import { createTelemetry } from "./telemetry.mjs";
import * as defaultSource from "../adapters/source.mjs";
import { resolveExtensions, mergedLexiconExtra, mergedLaneVocab, defaultCodeLaneVocab, activeDomainPacks, defaultCodeDomainPacks } from "./extensions.mjs";
import { runTurn, hasSeededVocabulary, vocabExampleHint, codeDomainActive as codeDomainActiveOf } from "./chat.mjs";
import { resolveGameConfig } from "../domain/game-config.mjs";
import { emptyRecord, resolveDiscourseConfig } from "../domain/discourse.mjs";
import { resolveRecognitionConfig } from "../domain/router/recognize.mjs";
import { resolveResearchConfig } from "./research.mjs";
import { resolveNewsConfig } from "./news.mjs";
import { normalizeResearchChoice } from "../adapters/corpus/research-source.mjs";
import { sessionLogHeaderMarkdown, sessionLogTurnMarkdown, sessionLogEndMarkdown } from "./session-log-format.mjs";

/** Where session logs live, relative to the target repo. `.tmct/` is the repo's
 *  one artifact directory (gitignored, machine-local) — flip this single constant
 *  if the operator prefers a different location. */
export const SESSION_LOG_DIR = ".tmct";

/** The base (no-focus) prompt. With a focus set the shell shows `tmct(label)>`. */
export const PROMPT = "tmct> ";

/** What a teach or a retract carries in a session that keeps nothing (--ephemeral,
 *  tmct.toml's [graph] read_only, or the "memory" backend). */
export const DISCARDED_WRITE_NOTE =
  "(this session keeps nothing — the fact is gone when it ends. Run without --ephemeral, "
  + "or on a stored backend, to keep it.)";

// ---- repo-root resolution: default the target to the GIT ROOT, not raw cwd ----

/** The git top-level for `cwd`, or null if not in a repo (or git is unavailable).
 *  Injected into runChat so tests exercise repo resolution without a real git tree. */
export function gitToplevel(cwd = process.cwd()) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (r.status === 0) { const p = String(r.stdout || "").trim(); return p || null; }
  } catch { /* git missing / not a repo — fall back to cwd */ }
  return null;
}

// ---- W3: seedMemory → bootstrap (first run in a graph-less repo) ----

/** Bootstrap <repo> for tmct on a graph-less first run: delegates to the FULL
 *  `initRepo(repo, {persona: PERSONA_PRESETS.human, env})` — the exact same
 *  function `tmct init` calls — so a library consumer gets the SAME
 *  first-run experience: real `.tmct/` scaffold, a written `tmct.toml`,
 *  `.tmct/init.json` provenance, not just a seed marker. `initRepo` only
 *  writes `tmct.toml` when absent, and only (re)seeds when the marker is
 *  absent, so a repeat call after a prior CLI `tmct init` is a safe no-op.
 *  Returns `initRepo`'s own `seedResult` on a fresh seed, null when
 *  skipped/failed. */
async function seedBootstrapMemory(repo, env = process.env) {
  try {
    const { initRepo, PERSONA_PRESETS } = await import("./init.mjs");
    const result = await initRepo(repo, { persona: PERSONA_PRESETS.human, env });
    return result.seeded ? result.seedResult : null;
  } catch {
    return null; // repo/corpus unavailable — bootstrap proceeds unseeded
  }
}

/** The seed banner line — renders every `perBundle` entry that actually
 *  appended facts this run, in the entries' own fixed order (seon,
 *  conceptnet, then the rest sorted by name), joined with " + ". No bundle
 *  is privileged as one of "the first two" — a single active bundle renders
 *  with no " + " at all. */
function seedBannerLine(seeded) {
  const clauses = Object.entries(seeded.perBundle || {})
    .filter(([, r]) => r && r.appended > 0)
    .map(([name, r]) => `${r.appended} ${name}`);
  return `seeded ${seeded.appended} starter facts (${clauses.join(" + ")}) — /memory to inspect`;
}

/** Trim a focus label for the prompt so a long module path can't run the line off. */
const shortLabel = (l) => { const s = String(l); return s.length > 40 ? "…" + s.slice(-39) : s; };
const promptFor = (focus) => (focus ? `tmct(${shortLabel(focus.label)})> ` : PROMPT);

/**
 * The SESSION SINK — everything a chat shell (readline below, the Ink TUI, any
 * future surface) must share so the on-disk session contract stays identical
 * no matter what draws the screen: repo/config resolution + the one-time
 * graph load, the transcript log + structured sidecar with per-turn
 * writeLog → writeSidecar → upsertGraph sequencing (ORDER IS LOAD-BEARING:
 * the memory side-write recovers each turn's ANSWER by re-reading the
 * transcript, so the log line must be flushed before the graph upsert), and
 * opt-in telemetry + end-of-session close.
 *
 * The returned object IS the caller-owned session handle — created here,
 * disposed by the caller (`close()`, idempotent), with NO process-global
 * state. Two handles never clobber each other (each owns its own
 * focus/lastAnswer/streams/sessionId).
 *
 * Returns { repo, config, graph, lexicon, memoryDir, moduleCount, version, sessionId,
 * logFile, sidecarFile, bannerLines, empty, focus, lastAnswer, turns, promptFor(),
 * turn(line), close() }. `turn(line)` runs one dispatched turn through runTurn and the
 * full sink sequencing, returning { answer, end, prompt }; `close()` is idempotent.
 * `turn(line, {retrieval})` passes this turn's own corpus-retrieval context,
 * overriding the session-level `retrieval` option for that turn.
 */
export async function createSession({
  repoPath,
  graphPaths,
  configPath,
  source = defaultSource,
  env = process.env,
  cwd = process.cwd(),
  gitRoot = gitToplevel,
  ephemeral = false,
  narrate = false,
  liveReference = false,
  // Which research source "research <topic>" fetches from: this session's
  // starting value. Precedence — /wikipedia|/wikidata in chat (mutable,
  // applied to session state by `turn()` below) > this param (`tmct chat
  // --research-source`) > tmct.toml's [research] source > "wikipedia".
  // Omitted (null) defers entirely to the toml/default tier.
  researchSource = null,
  // The /news command's fetcher/research-provider set for this session —
  // `{ newsFetchers, getResearchProvider, preflightNewsUrl }` (news.mjs's own
  // ctx.providers shape). Omitted (the default) leaves it to runCommand's own
  // fallback (KB enrichment through the shared research provider, contemporary
  // polling reporting an honest "no-fetcher" per source). The seam a caller —
  // a test, or a host embedding tmct with its own source set — hands in a
  // fixed provider set without touching the network, the same way
  // registerResearchProvider does for the research lane.
  newsProviders = null,
  // The storage-backend seam: the default (empty or "default") resolves to
  // Backend C — the sqlite store at .tmct/memory/graph.sqlite, a live
  // node:sqlite connection lazily imported on open. The flat-file Backend A is
  // retired from routing. "memory" selects Backend B (zero disk I/O,
  // session-scoped). This is `tmct chat --memory-backend <...>`'s
  // already-resolved value; full precedence (this param > TMCT_MEMORY_BACKEND
  // env > tmct.toml > the sqlite default) resolved below. A row backend OBJECT
  // (or a wrapRowBackend handle) selects Backend D and bypasses that
  // precedence entirely — a caller injecting a store has already chosen.
  memoryBackend = null,
  // The tool-name prefix a host's own follow-up hints should use in place of
  // "tmct_" (e.g. seonix's own tool names) — threaded onto `config` below so
  // dispatchTool's handlers (kit.mjs/tmct-search.mjs/tmct-members.mjs/
  // tmct-context.mjs) render hints under the host's own names. Omitted (the
  // default) preserves today's "tmct_" behavior exactly.
  toolNamePrefix,
  // Which individual the adventure lane's world-mutating verbs act as —
  // adventure.mjs's own actingSubject parameter, threaded up to session level
  // so one session can play a single mud character rather than always
  // "player". Omitted (the default) preserves today's single-player behavior
  // exactly; a session speaks for exactly one character for its whole
  // lifetime (four mud.html characters means four sessions, not one session
  // switching identity turn to turn).
  actingSubject,
  // What the corpus retrieval behind this session's turns did, in
  // retrieve-subgraph's own metrics shape ({mode, bounded, bands}). It decides
  // the corpus-scope line an answer carries: what the query pulled in, whether
  // a budget cut it short, or that the supplement was absent altogether. A
  // caller that retrieves per turn passes its own context to `turn(line,
  // {retrieval})` instead, which wins over this one. Omitted (the default)
  // means no corpus behind this session, and every answer is byte-identical to
  // a run without the seam.
  retrieval = null,
  // The session-log filesystem seam: mkdir/createWriteStream, injectable so a
  // test can exercise the unwritable-log guard by rejecting at the seam
  // itself rather than by making a real directory unwritable — chmod-based
  // unwritability is invisible to a process running as root (CI's container
  // user), which the real filesystem can't be made to enforce portably.
  logFs = { mkdir, createWriteStream },
  // Marks a world already LIVE for this session, bypassing openAdventure's
  // "play <world>" opener — that opener requires a shipped "player"
  // individual (its own protection against mis-firing on a non-adventure
  // world like spider-fly's board), which a multi-character world such as
  // mud-garden deliberately never ships. The caller is responsible for
  // seeding that world's facts/rules into this repo's store BEFORE opening
  // any session against it (see test/services/adventure*.test.mjs's
  // loadShippedWorldInto for the pattern) — one shared world, several
  // sessions (one per actingSubject) pointed at the same repoPath. Omitted
  // (the default) preserves today's behavior: a world only goes live via its
  // own "play <world>" opener line.
  adventureWorld,
} = {}) {
  // EPHEMERAL mode (--ephemeral, or TMCT_EPHEMERAL=1): read the target graph but
  // write NOTHING back into it. The shipped examples run this way so a demo never
  // dirties the committed code graph (`npm run example:mini` used to fold a session
  // into examples/*/.tmct/graph.json and rewrite it). We still read config.graphFile
  // for structure; only the WRITE base (logs, memory, sessions) is diverted to an OS
  // temp dir and the read-time graph upsert is suppressed.
  ephemeral = ephemeral || /^(1|true|yes)$/i.test(String(env.TMCT_EPHEMERAL || ""));
  // NARRATE mode (--narrate, or TMCT_NARRATE=1): start the session with
  // narrate mode already on. Session-scoped and mutable — `/narrate on|off`
  // flips it turn-to-turn (see `turn()` below). Default OFF.
  let narrateOn = narrate || /^(1|true|yes)$/i.test(String(env.TMCT_NARRATE || ""));
  // LIVE WIKIPEDIA supplement (--live-wikipedia, TMCT_LIVE_WIKIPEDIA=1, or
  // tmct.toml's corpus tier3 — the tier that already means "reach for the
  // network"): start the session with the live lookup enabled. Session-scoped
  // and mutable — `/wiki on|off` flips it turn-to-turn, exactly like narrate.
  // Default OFF; the toml tier is folded in below, once toml has resolved.
  let liveReferenceOn = liveReference || /^(1|true|yes)$/i.test(String(env.TMCT_LIVE_WIKIPEDIA || ""));
  // Graph resolution order (delegates to src/services/cli-args.mjs's
  // resolveRuntimeConfig): explicit --graph path(s) win outright; then --repo
  // (never silently redirected by env); then TMCT_GRAPH_FILE env; then
  // tmct.toml's graph_file at the resolved repo root; then git root; then cwd.
  // Defaults to the GIT ROOT, not raw cwd, so running from a nested package
  // dir doesn't index only that package.
  let repo;
  let config;
  // tmct.toml's normalized knobs, captured alongside `config` — used below
  // for the memory-backend precedence. `null` when no tmct.toml was readable.
  let toml = null;
  const explicitGraphs = (graphPaths || []).filter(Boolean);
  if (explicitGraphs.length) {
    repo = repoPath || gitRoot(cwd) || cwd;
    const resolvedGraphs = explicitGraphs.map((p) => resolve(cwd, p));
    config = resolvedGraphs.length > 1
      ? { graphFile: resolvedGraphs[0], graphFiles: resolvedGraphs }
      : { graphFile: resolvedGraphs[0] };
    try {
      const argv = ["--repo", repo];
      if (configPath) argv.push("--config", configPath);
      ({ toml } = await resolveRuntimeConfig({ argv, cwd, env: {}, gitRoot }));
    } catch { toml = null; }
  } else if (repoPath) {
    repo = repoPath;
    // env is deliberately withheld from resolveRuntimeConfig here (passed as
    // {}), so its own env-beats-repo-default tier can never fire.
    const argv = ["--repo", repoPath];
    if (configPath) argv.push("--config", configPath);
    ({ config, toml } = await resolveRuntimeConfig({ argv, cwd, env: {}, gitRoot }));
  } else {
    const root = gitRoot(cwd);
    repo = root || cwd;
    const envGraph = env.TMCT_GRAPH_FILE && String(env.TMCT_GRAPH_FILE).trim();
    if (envGraph) {
      config = loadConfig(env, cwd);
      try {
        const argv = [];
        if (configPath) argv.push("--config", configPath);
        ({ toml } = await resolveRuntimeConfig({ argv, cwd, env: {}, gitRoot }));
      } catch { toml = null; }
    } else {
      const argv = [];
      if (configPath) argv.push("--config", configPath);
      ({ config, toml } = await resolveRuntimeConfig({ argv, cwd, env, gitRoot }));
    }
  }
  // Every `config` branch above ends up here — set once so every downstream
  // hint-rendering call site (dispatchTool's handlers, via config.toolNamePrefix)
  // sees the same value regardless of which branch built `config`.
  config.toolNamePrefix = toolNamePrefix || "tmct_";

  // Every game's tuning knobs (spider-fly's mass economy, guess-the-number's
  // bounds, the shared plan lane's search-depth cap), resolved once per
  // session from this repo's tmct.toml — resolveGameConfig tolerates `toml`
  // being null (no file, or one that failed to load above) by falling back
  // to the shipped defaults for every key.
  const gameConfig = resolveGameConfig(toml);

  // The research lane's knobs (fan-out cap, depth, the polite interval) —
  // resolved once per session from the same tmct.toml, defaults filling
  // every unset key exactly as resolveGameConfig does above.
  const researchConfig = resolveResearchConfig(toml);
  // The news lane's knobs (enabled sources, poll/enrich cadence, the
  // enrichment/negative-cache budgets) — resolved once per session, the same
  // way researchConfig is above. Threaded into every runTurn call as a
  // stable, mutable object, so a `/news add`/`/news interval` mutation
  // persists turn to turn by reference (see runCommand's own /news branch).
  const newsConfig = resolveNewsConfig(toml);
  // This session's starting research source: the flag tier (`researchSource`,
  // e.g. `tmct chat --research-source`) over the toml tier over the shipped
  // default — /wikipedia|/wikidata in chat mutate this turn-to-turn below,
  // exactly like narrateOn/liveReferenceOn.
  let researchSourceOn = normalizeResearchChoice(researchSource || researchConfig.source);

  // tmct.toml's corpus tier3 opts the session into the live supplement too —
  // the flag/env tiers above stay authoritative when set.
  if (toml?.corpus?.tier === "tier3") liveReferenceOn = true;

  // tmct.toml's [graph] read_only turns any session against this repo into a
  // read-only one, exactly as --ephemeral does: the graph is read for
  // structure but nothing (upsert, logs, memory) is written back into the
  // repo's .tmct/. Committed example fixtures carry it so a plain
  // `tmct chat --repo examples/<x>` never mutates the hand-stamped graph.
  if (toml?.graph?.readOnly) ephemeral = true;

  // Ephemeral: keep config.graphFile pointing at the READ graph, but divert the
  // write base (repo → logs/memory/sessions) to a throwaway temp dir. The committed
  // target is never touched; the demo's memory simply doesn't persist across runs.
  // The banner still names the repo the user asked about, not the scratch dir.
  const readRepo = repo;
  if (ephemeral) repo = await mkdtemp(join(tmpdir(), "tmct-ephemeral-"));

  // Load the graph once up front — the banner needs the module count, and focus/`it`
  // resolution and contextId threading need it in hand. A missing artifact loads as
  // the empty bootstrap graph (source.mjs) — the banner says so; never an error.
  const graph = parseEntities(await source.fetchEntities(config));
  const moduleCount = graph.individuals.filter((i) => (i.class || "") === "Module").length;
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

  // Resolve this handle's extension entries + bias table ONCE per session —
  // no new per-turn I/O. Failure-tolerated: a malformed tmct.toml degrades to
  // the shipped builtins with an empty bias table, never an error.
  let extEntries = null;
  let biasByBundle = {};
  try { ({ entries: extEntries, biasByBundle } = await resolveExtensions(repo)); }
  catch { extEntries = null; biasByBundle = {}; }

  // The code-domain predicate (chat.mjs): a loaded graph with modules, or a
  // code-domain bundle active in this repo's tmct.toml/persona (the `code`
  // pack, or a direct `seon` activation predating it) — computed ONCE per
  // session and threaded into every turn, so every code-vocabulary surface
  // (counts, misses, banner, greeting, orientation, help) reads the same
  // answer all session long.
  const codePackActive = Boolean(extEntries?.get("seon")?.active || extEntries?.get("code")?.active);
  const domainActive = codeDomainActiveOf({ graph, seonActive: codePackActive });

  // This session's merged lane vocabulary (count nouns/class labels/help rows/
  // the miss-recovery pointer) — extensions.mjs's mergedLaneVocab over every
  // active pack. A real code graph with no pack formally active (a fixture, a
  // provider-supplied graph, a repo indexed before this pack existed) still
  // needs the code vocabulary to render today's answers, so it falls back to
  // the shipped code pack's own vocabulary — the same "a real graph is
  // enough" rule domainActive itself applies, just above. Empty when the
  // domain is inactive: a bare session imports nothing and carries none of it.
  let laneVocab = extEntries
    ? await mergedLaneVocab(extEntries, biasByBundle)
    : { countNouns: {}, classLabels: {}, helpRows: [], missRecoveryPointer: "" };
  if (domainActive && !Object.keys(laneVocab.countNouns).length) {
    laneVocab = await defaultCodeLaneVocab();
  }

  // Which packs supplied that vocabulary, read from each pack's own
  // declaration — what /capabilities names as this session's loaded domains.
  // Same "a real graph is enough" fallback as the vocabulary itself.
  let domainPacks = extEntries ? await activeDomainPacks(extEntries, biasByBundle) : [];
  if (domainActive && !domainPacks.length) domainPacks = await defaultCodeDomainPacks();

  // Load this handle's lexicon once, MERGED with any active lexicon/pack
  // extension entries (ascending-bias merge order so a higher-bias bundle's
  // same-lemma entry wins deterministically). Failure-tolerated — a broken
  // lexicon degrades to the lazy per-turn load inside assertTurn.
  let lexicon = null;
  try {
    const { loadLexicon } = await import("../domain/grammar/lexicon.mjs");
    const extra = extEntries ? await mergedLexiconExtra(extEntries, biasByBundle) : null;
    lexicon = loadLexicon(extra ?? undefined);
  } catch { lexicon = null; }

  // Opt-in telemetry (default OFF → null → the sink's `tel?.record` is a no-op, and
  // nothing is written). The conversational session log + sidecar above stay the
  // authoritative chat record; this is the machine-readable query telemetry.
  const tel = createTelemetry({ env, config, surface: "chat" });

  const sessionId = uuidv7();
  const logDir = join(repo, SESSION_LOG_DIR);
  const sessionsDir = join(repo, SESSIONS_DIR_REL);
  // Every session records what it answered, so an unwritable target is the end
  // of the session. Say so once, in one place, whichever step hits it: the
  // mkdir, the stream's open, or the header write below.
  const unwritable = (e) => new Error(
    `cannot write the session log under ${logDir} (${e?.code || e?.message || e}). `
    + "Every session records what it answered, so chat needs write access there. "
    + "Point --repo at a writable directory, or run with --ephemeral to keep the session in a temp dir.",
  );
  try {
    await logFs.mkdir(logDir, { recursive: true });
    await logFs.mkdir(sessionsDir, { recursive: true });
  } catch (e) { throw unwritable(e); }
  const logFile = join(logDir, `session-${sessionId}.md`);
  const sidecarFile = join(sessionsDir, `session-${sessionId}.jsonl`);
  const stream = logFs.createWriteStream(logFile, { flags: "a" });
  const sidecar = logFs.createWriteStream(sidecarFile, { flags: "a" });
  // A stream with no "error" listener turns a failed open into an unhandled
  // 'error' event, which is a raw Node stack trace and a dead process. The
  // write callbacks below reject with the same error, so the listener only has
  // to keep the event handled.
  stream.on("error", () => {});
  sidecar.on("error", () => {});
  // Awaited writes: each chunk is handed to the OS before the turn completes, so a
  // killed session keeps everything up to the last completed turn — in both files.
  const flush = (s, text) =>
    new Promise((resolve, reject) => s.write(text, (e) => (e ? reject(e) : resolve())));
  const writeLog = (text) => flush(stream, text);
  const writeSidecar = (obj) => flush(sidecar, JSON.stringify(obj) + "\n");

  const startIso = new Date().toISOString();
  try {
    await writeLog(sessionLogHeaderMarkdown({ version, sessionId, startedAt: startIso, repo }));
    await writeSidecar({ type: "session", id: sessionId, started: startIso, repo, tmctVersion: version });
  } catch (e) {
    stream.destroy();
    sidecar.destroy();
    throw unwritable(e);
  }

  // Read-time graph upsert (sessions.mjs): after every turn, the session becomes /
  // stays a first-class Session individual in graph.json (crash-safe: turn n is in
  // the graph before turn n+1 runs). Best-effort — a re-index or vanished
  // artifact mid-session must degrade the recording, never kill the chat.
  const turnRecords = [];
  const upsertGraph = async (ended) => {
    if (ephemeral) return; // a demo/read-only session never writes back to the graph
    if (!turnRecords.length) return; // a zero-turn session never pollutes the graph
    try { await appendSessionToGraph(config.graphFile, { id: sessionId, started: startIso, ended, turns: turnRecords }); }
    catch { /* best-effort — see above */ }
  };

  // `memoryDir` is the opaque token every memory/core.mjs call in this file
  // threads through unchanged — always a Backend B/C/D handle from
  // openMemoryBackend now that the flat-file Backend A is retired from
  // routing. Precedence — CLI flag > env > tmct.toml > the sqlite default.
  //
  // A caller can also INJECT its own row store as `memoryBackend`: a backend
  // object, or a handle wrapRowBackend already produced (which is how a seed
  // overlay arrives). That object goes to openMemoryBackend as-is — config
  // resolution never sees it, and it must be tested before the String()
  // coercion below or it stringifies into a meaningless token.
  const { openMemoryBackend, isRowBackend, isRowHandle } = await import("../adapters/memory/core.mjs");
  const injectedRowStore = isRowBackend(memoryBackend) || isRowHandle(memoryBackend);
  const backendChoice = injectedRowStore
    ? memoryBackend
    : String(memoryBackend || env.TMCT_MEMORY_BACKEND || toml?.memory?.backend || "").trim().toLowerCase();
  // openMemoryBackend is the ONE shared resolver for this seam — init.mjs's
  // corpus seed calls the exact same function, so a repo's seeded facts and
  // its chat-taught facts always land in the same backend.
  const { dir: memoryDir, close: closeMemoryStore } = await openMemoryBackend(repo, backendChoice);

  const empty = graph.individuals.length === 0;
  // W3: FIRST RUN in a graph-less repo seeds a capped ConceptNet slice into
  // .tmct/memory so vocabulary questions ("what is a cache?") have something
  // honest to stand on from turn one. Guarded three ways: only the empty
  // bootstrap (a fixture/provider graph never seeds), only once (the marker),
  // and never when TMCT_NO_SEED=1 opts out.
  //
  // Known residual split: seedBootstrapMemory/hasSeededVocabulary resolve
  // their marker file off the STRING `repo` path (correct — the marker is a
  // file, not store content), so W3 seeding only fires on the default token —
  // an injected row store carries whatever seed its owner bundled and never
  // gets one written into it here. And sessions.mjs's per-turn utterance mirror still writes an
  // ordinary .tmct/memory/graph.json off the repo string — a file no routed
  // reader opens now that Backend A is retired from routing. Taught FACTS
  // themselves are unaffected: only the conversational transcript mirror
  // leaks onto disk, never the facts.
  let seeded = null;
  if (empty && backendChoice === "" && String(env.TMCT_NO_SEED || "") !== "1") {
    seeded = await seedBootstrapMemory(repo, env);
  }
  // vocabHint: computed ONCE per session (not per-turn — see runTurn's own
  // per-call fallback for direct/library callers). `seeded` is only truthy when
  // THIS run performed the seeding; a repo seeded by an EARLIER run (or `tmct
  // init`) still needs the marker check, so this covers both — see
  // hasSeededVocabulary's docblock.
  const vocabSeeded = Boolean(seeded) || (await hasSeededVocabulary(repo));
  const vocabHint = vocabExampleHint(vocabSeeded);
  // #3/#5: 0 modules means no code graph to answer structure questions from —
  // whether the graph file is absent (empty bootstrap) OR present with no code
  // entities (the degenerate trap). Both get orienting, non-over-promising banner
  // + greeting messaging rather than a silent dead-end.
  const noCodeGraph = moduleCount === 0;
  // A discarding session must not say the conversation is kept. Ephemeral
  // diverts every write to a temp dir and suppresses the graph upsert; the
  // "memory" backend keeps the store in-process. Both end when the process does.
  // An injected row store is durable but not tmct's file, so it gets its own
  // line rather than a path this session never writes.
  const discardsWrites = ephemeral || backendChoice === "memory";
  const whereItGoes = discardsWrites
    ? "nothing is written back — this session's facts and log are dropped when it ends"
    : injectedRowStore
      ? `the conversation is kept in your configured store — log ${logFile}`
      : `the conversation is remembered to ${DEFAULT_GRAPH_REL} — log ${logFile}`;
  const bannerLines = [
    noCodeGraph
      // No code graph: honest, orienting messaging — never an error before the prompt.
      // domainActive here means the seon bundle is active without an index yet
      // (e.g. --with-persona code, before `tmct index` runs) — same code-graph
      // framing as today. With no code domain at all, naming "no code graph" would
      // itself be a code-domain leak, so a bare install gets a neutral line instead.
      ? (domainActive
        ? `tmct chat — ${readRepo} — no code graph loaded — ${empty ? "starting empty" : "graph has no code entities"}; ${whereItGoes}`
        : `tmct chat — ${readRepo} — ${whereItGoes}`)
      : `tmct chat — ${readRepo} — ${moduleCount} module(s) — `
        + (discardsWrites ? `${whereItGoes}` : `log ${logFile}`),
    // the honest seed line appears ONLY on the run that actually seeded — the count
    // is the TOTAL appended, split into the curated SEON ontology + the ConceptNet band
    // (+ any other active extension bundle, e.g. an activated tier-2 corpus).
    ...(seeded ? [seedBannerLine(seeded)] : []),
    // no code graph → point at how to GET one (a graph producer / --repo / the shipped
    // example), and at what IS answerable now — `vocabHint` is only ever a term
    // confirmed to resolve in THIS session's actual seed state (see vocabExampleHint),
    // never a hardcoded example that might not have been seeded. tmct can index a
    // repo itself (`tmct index`) or read a graph any other producer wrote. With no
    // code domain active, the code-structure pointer has nothing to point at, so
    // this line carries just the teach/vocabulary hint. The pointer text itself
    // is the active code pack's own miss-recovery clause (laneVocab, above) —
    // never a chat-session.mjs literal, so a host pack can carry its own.
    ...(noCodeGraph ? [domainActive
      ? `${laneVocab.missRecoveryPointer} ${vocabHint}`
      : vocabHint] : []),
    "pass --repo <path> to target a different repo",
    "ask a question, or /help for commands (/stats for an overview) — /exit to leave",
  ];

  let turns = 0;
  let focus = null; // the current focus entity ({id,label}) — threaded turn to turn
  let last = null;  // the last dispatched answer ({query,answer,detail}) — why/say-more re-renders it
  // The in-progress plan (goals/moves/cursor) — cleared by completion or a
  // fresh goal, never by an aside. `adventureWorld` seeds it as already
  // playing that world (see the option's own doc comment above) instead of
  // starting null and waiting for a "play <world>" opener line.
  let planState = adventureWorld ? { adventure: { world: adventureWorld } } : null;
  let researchState = null; // the in-progress research queue — advanced by "research next", cleared by completion or "research stop"
  let newsState = null; // the news feed's session state (items/ledger/health/requestLog/metrics) — threaded the same way researchState is
  // The typed discourse record ([discourse] max_referents caps it) — session-scoped
  // like the focus, threaded turn to turn, never persisted.
  let discourseRecord = emptyRecord(resolveDiscourseConfig(toml));
  // The recognition trace cap ([recognition] max_trace) — resolved once per
  // session, read by the surfaces that fold a trace back out of the store.
  const recognitionConfig = resolveRecognitionConfig(toml);
  let closed = false;

  return {
    repo, config, graph, lexicon, memoryDir, moduleCount, version, sessionId,
    logFile, sidecarFile, bannerLines, empty, biasByBundle,
    // Same handle as `memoryDir`, named to match dispatchTool's `memoryBackend`
    // context param — a caller that wants a tool call (tmct_export, …) to read
    // from THIS session's already-open store passes `memoryBackend: session.memoryBackend`
    // rather than letting the tool re-derive a backend from config/tmct.toml.
    memoryBackend: memoryDir,
    // Mutable between-turn state — read-only to the caller, so a shell can render the
    // prompt/expand-hint without reaching into runTurn's threading.
    get focus() { return focus; },
    get lastAnswer() { return last; },
    get planState() { return planState; },
    get researchState() { return researchState; },
    get newsState() { return newsState; },
    get turns() { return turns; },
    get narrate() { return narrateOn; },
    get liveReference() { return liveReferenceOn; },
    get researchSource() { return researchSourceOn; },
    promptFor: () => promptFor(focus),

    /** One dispatched turn through the FULL sink sequencing (writeLog → writeSidecar
     *  → telemetry → upsertGraph, in that exact order). Returns { answer, end, prompt,
     *  plan, record, factsTouched } — record is the same sidecar turn record the
     *  session persists, and factsTouched is runTurn's own diffed Fact-row list
     *  (empty when the turn wrote nothing). A throwing runTurn must never abort
     *  the session: a piped/non-interactive driver has no other chance to see
     *  this turn's answer. */
    async turn(line, { retrieval: turnRetrieval = null } = {}) {
      let result;
      try {
        result = await runTurn(line, { config, source, graph, focus, last, memoryDir, sessionId, env, lexicon, narrate: narrateOn, liveReference: liveReferenceOn, researchSource: researchSourceOn, vocabHint, tel, biasByBundle, planState, gameConfig, recognitionConfig, researchState, researchConfig, newsState, newsConfig, newsProviders, discourse: discourseRecord, actingSubject, codeDomainActive: domainActive, laneVocab, domainPacks, retrieval: turnRetrieval ?? retrieval });
      } catch (e) {
        const ts = new Date().toISOString();
        const message = e instanceof Error ? e.message : String(e);
        await writeLog(sessionLogTurnMarkdown({ startedAt: ts, turnNumber: turns + 1, query: line, answer: `error: ${message}` }));
        const errorRecord = { type: "error", ts, query: line, error: message };
        await writeSidecar(errorRecord);
        turnRecords.push(errorRecord);
        turns += 1;
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, prompt: promptFor(focus) };
      }
      const { record, focus: nextFocus, last: nextLast, end, narrate: nextNarrate, liveReference: nextLiveReference, researchSource: nextResearchSource } = result;
      // "noted — remembered" reports a durable write. In a session that keeps
      // nothing it is the last word on a fact that dies with the process, so
      // say where the fact actually went.
      const answer = discardsWrites && (record.via === "assert" || record.via === "retract")
        ? `${result.answer}\n${DISCARDED_WRITE_NOTE}`
        : result.answer;
      focus = nextFocus;
      last = nextLast;
      if ("planState" in result) planState = result.planState;
      if ("researchState" in result) researchState = result.researchState;
      if ("newsState" in result) newsState = result.newsState;
      if ("discourse" in result) discourseRecord = result.discourse;
      // /narrate on|off and /wiki on|off (runCommand) ride the turn RESULT the
      // same way a focus update does — apply them to this handle's
      // session-scoped state.
      if (typeof nextNarrate === "boolean") narrateOn = nextNarrate;
      // four-state: false (off), true (rescue on a miss), "supplement" (also
      // append a cited read-out under every grounded vocabulary answer), or
      // "always" (widen that to every grounded answer).
      if (typeof nextLiveReference === "boolean" || nextLiveReference === "supplement" || nextLiveReference === "always") liveReferenceOn = nextLiveReference;
      if (typeof nextResearchSource === "string") researchSourceOn = nextResearchSource;
      await writeLog(sessionLogTurnMarkdown({ startedAt: record.ts, turnNumber: turns + 1, query: line, answer }));
      await writeSidecar(record);
      turnRecords.push(record);
      // One telemetry line per dispatched turn (OFF by default → no-op). query.raw is
      // the user's line; `tool` the slash-command if any; count the cited entity ids.
      tel?.record({
        tool: record.command,
        query: { raw: line },
        response: { count: (record.answeredIds || []).length, node_ids: record.answeredIds || [] },
      });
      await upsertGraph(record.ts);
      turns += 1;
      return { answer, end: Boolean(end), prompt: promptFor(focus), plan: result.plan ?? null, research: result.research, record, factsTouched: result.factsTouched };
    },

    /** End-of-session close: end lines in both artifacts, the final graph upsert
     *  (which also triggers the memory fold), stream flush, the Backend C
     *  connection close (a no-op for Backend A/B). Idempotent. */
    async close() {
      if (closed) return;
      closed = true;
      const endIso = new Date().toISOString();
      const closingTurnNumber = turns + 1;
      await writeLog(sessionLogTurnMarkdown({ startedAt: endIso, turnNumber: closingTurnNumber, query: "/exit", answer: "" }));
      await writeLog(sessionLogEndMarkdown({ endedAt: endIso, turnCount: closingTurnNumber }));
      await writeSidecar({ type: "end", ts: endIso });
      await upsertGraph(endIso);
      await new Promise((resolve) => stream.end(resolve));
      await new Promise((resolve) => sidecar.end(resolve));
      await closeMemoryStore();
    },
  };
}

/**
 * The interactive readline shell over createSession — the `--plain` surface and
 * the scripted-test surface. Streams are injectable so tests run sessions
 * without a TTY. A repo with NO graph artifact is not an error: the session
 * starts from the empty bootstrap graph (the banner says so honestly) and the
 * first turn's fold-in creates .tmct/graph.json from the conversation itself.
 * Returns { logFile, sidecarFile, turns } once the session ends.
 */
export async function runChat({
  repoPath,
  graphPaths,
  configPath,
  input = process.stdin,
  output = process.stdout,
  source = defaultSource,
  env = process.env,
  cwd = process.cwd(),
  gitRoot = gitToplevel,
  ephemeral = false,
  narrate = false,
  liveReference = false,
  researchSource = null,
  memoryBackend = null,
  toolNamePrefix,
  actingSubject,
} = {}) {
  // createSession's first-run seed (~2-3s) produces ZERO output until it fully
  // resolves, which otherwise reads as `npm run chat` hanging with total silence.
  output.write("tmct — starting…\n");
  const session = await createSession({ repoPath, graphPaths, configPath, source, env, cwd, gitRoot, ephemeral, narrate, liveReference, researchSource, memoryBackend, toolNamePrefix, actingSubject });

  const dim = (s) => (env.NO_COLOR || !output.isTTY ? s : `\x1b[2m${s}\x1b[0m`);
  for (const line of session.bannerLines) output.write(dim(line) + "\n");

  const rl = createInterface({ input, output, prompt: PROMPT });
  rl.on("SIGINT", () => rl.close()); // Ctrl+C behaves like /exit (clean close, log flushed)
  let closed = false;
  rl.on("close", () => { closed = true; });
  const prompt = () => { if (!closed) rl.prompt(); }; // input may end while a turn is in flight

  prompt();
  // try/finally: session.close() is the ONLY code path that writes end-markers and
  // flushes the log/sidecar write streams (stream.end()/sidecar.end()) — an
  // unhandled throw anywhere in the loop body must still reach it, or a
  // piped/non-interactive run can lose buffered writes outright, not just this
  // turn's data. session.turn() now catches its own errors (see createSession),
  // so this is defense in depth for anything else that might throw here.
  try {
    for await (const raw of rl) { // Ctrl+D / closed stdin ends the iteration cleanly
      const line = raw.trim();
      if (line === "/exit") break;
      if (line) {
        const { answer, end, prompt: nextPrompt } = await session.turn(line);
        output.write(answer + "\n");
        rl.setPrompt(nextPrompt);
        if (end) break; // a conversational "bye"/"goodbye" — clean end, same as /exit
      }
      prompt();
    }
  } finally {
    rl.close();
    await session.close();
  }
  return { logFile: session.logFile, sidecarFile: session.sidecarFile, turns: session.turns };
}
