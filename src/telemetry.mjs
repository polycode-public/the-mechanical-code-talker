// telemetry.mjs — OPT-IN, fire-and-forget query telemetry (PLAN_TMCT_TELEMETRY.md).
//
// The measurement contract is absolute: telemetry is OFF by default and the OFF path
// must be BYTE-IDENTICAL — no file, no stdout/stderr change, ~zero cost. createTelemetry
// returns NULL when disabled, so every call site is a single falsy check: `tel?.record(…)`.
//
// When enabled it appends ONE JSONL line per event to `<graphDir>/tmct-<id>.log`
// (i.e. next to graph.json, in the repo's `.tmct/` artifact dir). Writes are
// fire-and-forget with a swallowed catch: telemetry must NEVER throw, block, or write
// to stdout/stderr (stdout belongs to the chat surface). A structural redact() keeps file
// CONTENTS out of the log — it records only ids/paths/scores/sizes/counts.

import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { uuidv7 } from "./uuid.mjs";

/** Field names whose VALUES are (or embed) raw source and must never be logged. `body` is
 *  the Repository Interface's own field name for real source text (snippet()/context()'s
 *  source-capable body sections, PLAN item 2/3) — without it, raw source read via the
 *  now-source-capable createGraphService could leak straight into a telemetry log. */
const DROP_KEYS = new Set(["text", "content", "snippet", "body"]);
/** String fields longer than this are truncated — except query.raw (the user's own
 *  question, which is the correlation key and is not file content). */
const MAX_STR = 500;

/** Enabled iff `TMCT_TELEMETRY==="1"` OR `[telemetry] enabled=true` in the toml.
 *  The env wins BOTH directions: `TMCT_TELEMETRY==="0"` force-disables even when the
 *  toml turns it on. Default OFF (anything but "1"/"0" in the env falls through to toml). */
export function telemetryEnabled(env = process.env, toml = null) {
  const e = env?.TMCT_TELEMETRY;
  if (e === "1") return true;
  if (e === "0") return false;
  return toml?.telemetry?.enabled === true;
}

/** The invocation id that correlates a log ↔ a host process. A host (the bench rig,
 *  a wrapping agent) may stamp `TMCT_INVOCATION_ID` so its trace/record and this log
 *  share one id; absent, we mint a fresh time-sortable uuidv7. */
export function invocationId(env = process.env) {
  return (env?.TMCT_INVOCATION_ID && String(env.TMCT_INVOCATION_ID)) || uuidv7();
}

/** Structural redaction: drop any field named text/content/snippet at any depth, and
 *  truncate string fields longer than MAX_STR — EXCEPT `query.raw`. Records only
 *  ids/paths/scores/sizes/counts, never file contents. Pure; returns a fresh value. */
export function redact(value, path = "") {
  if (typeof value === "string") {
    if (path === "query.raw") return value; // the correlation key — kept whole
    return value.length > MAX_STR ? value.slice(0, MAX_STR) : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, path));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = redact(v, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

/**
 * Build a telemetry sink for one surface, or NULL when telemetry is disabled (the
 * common OFF path — the caller's `tel?.record(…)` then costs one falsy check).
 *
 * When enabled, returns { id, file, record(fields) }. `record` stamps the schema-v1
 * envelope ({v, id, seq, ts, surface}) onto the redacted, sparse caller fields and
 * appends ONE JSONL line, fire-and-forget with a swallowed catch. `seq` is strictly
 * increasing per sink. Record schema v1 fields (all sparse/optional — only include
 * what a surface actually has):
 *   { v, id, seq, ts, surface, tool,
 *     query:    { raw, family, ambiguous, candidates },
 *     response: { node_ids, scores, count, truncated, tier, topup },
 *     perf:     { ms_total, ms_load, cold_load, graph_modules, graph_edges },
 *     quality:  {},
 *     cost:     { returned_chars, returned_tokens_est, cache_channel } }
 */
export function createTelemetry({ env = process.env, config, toml = null, surface } = {}) {
  if (!telemetryEnabled(env, toml)) return null;
  const id = invocationId(env);
  const file = join(dirname(config.graphFile), `tmct-${id}.log`);
  let seq = 0;
  const record = (fields = {}) => {
    try {
      const line = { v: 1, id, seq: seq++, ts: new Date().toISOString(), surface, ...redact(fields) };
      // Fire-and-forget: never await, never let a write error surface. Telemetry must
      // not block a query or corrupt stdout.
      appendFile(file, JSON.stringify(line) + "\n").catch(() => {});
    } catch { /* redaction/serialisation must never throw a caller's turn */ }
  };
  return { id, file, record };
}
