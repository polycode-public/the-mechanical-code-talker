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
// readline loop below, src/tui/app.mjs's Ink shell). chat.mjs re-exports
// createSession/runChat/gitToplevel and the session constants so existing
// import sites keep working.

import { join, resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { loadConfig, DEFAULT_GRAPH_REL } from "../adapters/config.mjs";
import { resolveRuntimeConfig } from "../cli-args.mjs";
import { parseEntities } from "../codegraph.mjs";
import { SESSIONS_DIR_REL, appendSessionToGraph } from "../sessions.mjs";
import { uuidv7 } from "../adapters/uuid.mjs";
import { createTelemetry } from "../telemetry.mjs";
import * as defaultSource from "../adapters/source.mjs";
import { resolveExtensions, mergedLexiconExtra } from "../extensions.mjs";
import { runTurn, hasSeededVocabulary, vocabExampleHint } from "../chat.mjs";

/** Where session logs live, relative to the target repo. `.tmct/` is the repo's
 *  one artifact directory (gitignored, machine-local) — flip this single constant
 *  if the operator prefers a different location. */
export const SESSION_LOG_DIR = ".tmct";

/** The base (no-focus) prompt. With a focus set the shell shows `tmct(label)>`. */
export const PROMPT = "tmct> ";

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
    const { initRepo, PERSONA_PRESETS } = await import("../init.mjs");
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
  // The storage-backend seam: "file" (default) keeps memoryDir a plain
  // repo-path string (Backend A). "memory" selects Backend B (zero disk I/O,
  // session-scoped). "sqlite" selects Backend C (a live node:sqlite
  // connection, lazily imported only when chosen). This is `tmct chat
  // --memory-backend <...>`'s already-resolved value; full precedence (this
  // param > TMCT_MEMORY_BACKEND env > tmct.toml > "default") resolved below.
  memoryBackend = null,
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
  // Graph resolution order (delegates to src/cli-args.mjs's
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

  // Ephemeral: keep config.graphFile pointing at the READ graph, but divert the
  // write base (repo → logs/memory/sessions) to a throwaway temp dir. The committed
  // target is never touched; the demo's memory simply doesn't persist across runs.
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

  // Load this handle's lexicon once, MERGED with any active lexicon/pack
  // extension entries (ascending-bias merge order so a higher-bias bundle's
  // same-lemma entry wins deterministically). Failure-tolerated — a broken
  // lexicon degrades to the lazy per-turn load inside assertTurn.
  let lexicon = null;
  try {
    const { loadLexicon } = await import("../grammar/lexicon.mjs");
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
  await mkdir(logDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  const logFile = join(logDir, `session-${sessionId}.log`);
  const sidecarFile = join(sessionsDir, `session-${sessionId}.jsonl`);
  const stream = createWriteStream(logFile, { flags: "a" });
  const sidecar = createWriteStream(sidecarFile, { flags: "a" });
  // Awaited writes: each chunk is handed to the OS before the turn completes, so a
  // killed session keeps everything up to the last completed turn — in both files.
  const flush = (s, text) =>
    new Promise((resolve, reject) => s.write(text, (e) => (e ? reject(e) : resolve())));
  const writeLog = (text) => flush(stream, text);
  const writeSidecar = (obj) => flush(sidecar, JSON.stringify(obj) + "\n");

  const startIso = new Date().toISOString();
  await writeLog(`# tmct chat ${version} — session started ${startIso} — repo ${repo}\n\n`);
  await writeSidecar({ type: "session", id: sessionId, started: startIso, repo, tmctVersion: version });

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
  // threads through unchanged. Backend A (default) keeps it the plain repo
  // string; Backend B/C swap in a handle instead. Precedence — CLI flag > env
  // > tmct.toml > default.
  const backendChoice = String(memoryBackend || env.TMCT_MEMORY_BACKEND || toml?.memory?.backend || "").trim().toLowerCase();
  // openMemoryBackend is the ONE shared resolver for this seam — init.mjs's
  // corpus seed calls the exact same function, so a repo's seeded facts and
  // its chat-taught facts always land in the same backend.
  const { openMemoryBackend } = await import("../adapters/memory/core.mjs");
  const { dir: memoryDir, close: closeMemoryStore } = await openMemoryBackend(repo, backendChoice);

  const empty = graph.individuals.length === 0;
  // W3: FIRST RUN in a graph-less repo seeds a capped ConceptNet slice into
  // .tmct/memory so vocabulary questions ("what is a cache?") have something
  // honest to stand on from turn one. Guarded three ways: only the empty
  // bootstrap (a fixture/provider graph never seeds), only once (the marker),
  // and never when TMCT_NO_SEED=1 opts out.
  //
  // Known Backend B/C limitation: seedBootstrapMemory/hasSeededVocabulary and
  // sessions.mjs's own per-turn utterance mirror all resolve their marker
  // file / repoDir directly off the STRING `repo` path, not the actual
  // Backend B/C handle — so W3 seeding is skipped for a non-default backend,
  // and a Backend B/C session's Utterance/Session individuals still land in
  // an ordinary Backend-A .tmct/memory/graph.json. Taught FACTS themselves
  // are unaffected: only the conversational transcript mirror leaks onto
  // disk, never the facts.
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
  const bannerLines = [
    noCodeGraph
      // No code graph: honest, orienting messaging — never an error before the prompt.
      ? `tmct chat — ${repo} — no code graph loaded — ${empty ? "starting empty" : "graph has no code entities"}; ` +
        `the conversation is remembered to ${DEFAULT_GRAPH_REL} — log ${logFile}`
      : `tmct chat — ${repo} — ${moduleCount} module(s) — log ${logFile}`,
    // the honest seed line appears ONLY on the run that actually seeded — the count
    // is the TOTAL appended, split into the curated SEON ontology + the ConceptNet band
    // (+ any other active extension bundle, e.g. an activated tier-2 corpus).
    ...(seeded ? [seedBannerLine(seeded)] : []),
    // no code graph → point at how to GET one (a graph producer / --repo / the shipped
    // example), and at what IS answerable now — `vocabHint` is only ever a term
    // confirmed to resolve in THIS session's actual seed state (see vocabExampleHint),
    // never a hardcoded example that might not have been seeded. tmct reads graphs;
    // it never indexes code itself.
    ...(noCodeGraph ? [`for code structure, point me at a .tmct/graph.json with --repo <path> or try \`npm run example:mini\` (tmct reads graphs, it doesn't index code). ${vocabHint}`] : []),
    "pass --repo <path> to target a different repo",
    "ask a question, or /help for commands (/stats for an overview) — /exit to leave",
  ];

  let turns = 0;
  let focus = null; // the current focus entity ({id,label}) — threaded turn to turn
  let last = null;  // the last dispatched answer ({query,answer,detail}) — why/say-more re-renders it
  let planState = null; // the in-progress plan (goals/moves/cursor) — cleared by completion or a fresh goal, never by an aside
  let closed = false;

  return {
    repo, config, graph, lexicon, memoryDir, moduleCount, version, sessionId,
    logFile, sidecarFile, bannerLines, empty, biasByBundle,
    // Mutable between-turn state — read-only to the caller, so a shell can render the
    // prompt/expand-hint without reaching into runTurn's threading.
    get focus() { return focus; },
    get lastAnswer() { return last; },
    get planState() { return planState; },
    get turns() { return turns; },
    get narrate() { return narrateOn; },
    promptFor: () => promptFor(focus),

    /** One dispatched turn through the FULL sink sequencing (writeLog → writeSidecar
     *  → telemetry → upsertGraph, in that exact order). Returns { answer, end, prompt,
     *  plan, record } — record is the same sidecar turn record the session persists.
     *  A throwing runTurn must never abort the session: a piped/non-interactive
     *  driver has no other chance to see this turn's answer. */
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, { config, source, graph, focus, last, memoryDir, sessionId, env, lexicon, narrate: narrateOn, vocabHint, tel, biasByBundle, planState });
      } catch (e) {
        const ts = new Date().toISOString();
        const message = e instanceof Error ? e.message : String(e);
        await writeLog(`${ts}\n> ${line}\nerror: ${message}\n`);
        const errorRecord = { type: "error", ts, query: line, error: message };
        await writeSidecar(errorRecord);
        turnRecords.push(errorRecord);
        turns += 1;
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, prompt: promptFor(focus) };
      }
      const { answer, logLines, record, focus: nextFocus, last: nextLast, end, narrate: nextNarrate } = result;
      focus = nextFocus;
      last = nextLast;
      if ("planState" in result) planState = result.planState;
      // /narrate on|off (runCommand) rides the turn RESULT the same way a focus
      // update does — apply it to this handle's session-scoped state.
      if (typeof nextNarrate === "boolean") narrateOn = nextNarrate;
      await writeLog(logLines.join("\n") + "\n");
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
      return { answer, end: Boolean(end), prompt: promptFor(focus), plan: result.plan ?? null, record };
    },

    /** End-of-session close: end lines in both artifacts, the final graph upsert
     *  (which also triggers the memory fold), stream flush, the Backend C
     *  connection close (a no-op for Backend A/B). Idempotent. */
    async close() {
      if (closed) return;
      closed = true;
      const endIso = new Date().toISOString();
      await writeLog(`${endIso}\n> /exit\nsession end ${endIso}\n`);
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
  memoryBackend = null,
} = {}) {
  // createSession's first-run seed (~2-3s) produces ZERO output until it fully
  // resolves, which otherwise reads as `npm run chat` hanging with total silence.
  output.write("tmct — starting…\n");
  const session = await createSession({ repoPath, graphPaths, configPath, source, env, cwd, gitRoot, ephemeral, narrate, memoryBackend });

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
