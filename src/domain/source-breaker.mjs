// source-breaker.mjs — the circuit breaker the external sources share: the
// live research adapters in a chat turn and the news page's KB lookups. Same
// machine as the turn surface's Dynamo-backed breaker, over state that needs
// no store behind it. A page has one writer and its state dies with the page;
// a CLI process has one writer and its state dies with the process. So the
// state is a plain object and every transition is a local assignment, with no
// conditional writes to settle races that cannot happen.
//
// Three states. Closed lets a lookup run; a systemic failure adds to a count
// inside a fixed window, and crossing a fixed threshold opens the breaker.
// Open skips the source outright until a fixed cooldown elapses, at which
// point the next caller probes once. The probe's own outcome decides closed
// or open again.
//
// What counts is the one rule every guard in this codebase shares: a throttle,
// a 5xx, or a timeout means the source is in trouble. A lookup that came back
// empty is an answer, and a 404 for a term nobody wrote an article about is
// the commonest answer of all — neither ever counts against a source.
//
// A skip changes what served an answer, so the caller collects the names it
// skipped and the answer says so through `sourceSkipNoteLine`.
//
// The clock is injected (default `Date.now`) so window rollover and cooldown
// expiry are reproducible without a real wall clock. No node builtins — this
// module ships in the browser bundles unchanged.

export const SOURCE_BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 60_000,
});

export const SOURCE_BREAKER_CLOSED = "closed";
export const SOURCE_BREAKER_OPEN = "open";
export const SOURCE_BREAKER_HALF_OPEN = "half-open";

/** HTTP statuses that mean the source itself is struggling rather than
 *  answering. A 4xx that is not a throttle or a request timeout is an answer:
 *  the term has no page, or the request was wrong. */
export function isSystemicSourceStatus(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return false;
  return code === 408 || code === 429 || code >= 500;
}

const TRANSPORT_FAILURE_NAMES = new Set(["AbortError", "TimeoutError", "NetworkError", "FetchError"]);

/** Does this failure mean the source itself is in trouble? Accepts whatever a
 *  fetch layer has to hand: a thrown transport error, an error carrying a
 *  status, or a response-shaped object. */
export function isSystemicSourceFailure(error) {
  if (!error) return false;
  if (TRANSPORT_FAILURE_NAMES.has(error.name)) return true;
  if (error.timedOut === true || error.aborted === true) return true;
  return isSystemicSourceStatus(error.status ?? error.statusCode);
}

/** How many systemic failures does this outcome carry? A bare number, an
 *  object counting its own (`{ systemicFailures }` — what a courtesy gate's
 *  stats diff hands back), or a single raw error to classify. */
export function failureCountFromOutcome(outcome) {
  if (outcome == null) return 0;
  if (typeof outcome === "number") return Number.isFinite(outcome) ? Math.max(0, Math.floor(outcome)) : 0;
  if (typeof outcome.systemicFailures === "number") return Math.max(0, Math.floor(outcome.systemicFailures));
  if ("error" in outcome) return isSystemicSourceFailure(outcome.error) ? 1 : 0;
  return 0;
}

/** One source's breaker. `decide()` answers whether this caller may reach the
 *  source and hands back the one call that closes the loop afterward:
 *  `report(outcome)`, made once the lookup (or its failure) is over. A caller
 *  that was told to skip gets a report that does nothing, since it has
 *  nothing to report. */
export function createSourceBreaker({
  source = "",
  clock = Date.now,
  failureThreshold = SOURCE_BREAKER_DEFAULTS.failureThreshold,
  windowMs = SOURCE_BREAKER_DEFAULTS.windowMs,
  cooldownMs = SOURCE_BREAKER_DEFAULTS.cooldownMs,
} = {}) {
  let state = SOURCE_BREAKER_CLOSED;
  let failures = 0;
  let windowStart = null;
  let openedAt = null;

  const noopReport = () => {};

  function open() {
    state = SOURCE_BREAKER_OPEN;
    openedAt = clock();
  }

  function recordSystemicFailure(count) {
    const now = clock();
    if (windowStart === null || now - windowStart >= windowMs) {
      windowStart = now;
      failures = count;
    } else {
      failures += count;
    }
    if (failures >= failureThreshold) open();
  }

  function resolveProbe(failed) {
    if (state !== SOURCE_BREAKER_HALF_OPEN) return;
    if (failed) { open(); return; }
    state = SOURCE_BREAKER_CLOSED;
    failures = 0;
    windowStart = null;
    openedAt = null;
  }

  return {
    source,

    /** The breaker's state, for narration and tests. Reading alone is never a
     *  transition — a caller deciding its own lookup goes through `decide`. */
    read() {
      return { source, state, failures, windowStart, openedAt };
    },

    decide() {
      if (state === SOURCE_BREAKER_CLOSED) {
        return {
          source,
          allowed: true,
          probe: false,
          report: (outcome) => {
            const count = failureCountFromOutcome(outcome);
            if (count > 0) recordSystemicFailure(count);
          },
        };
      }

      if (state === SOURCE_BREAKER_OPEN) {
        if (openedAt === null || clock() - openedAt < cooldownMs) {
          return { source, allowed: false, probe: false, report: noopReport };
        }
        state = SOURCE_BREAKER_HALF_OPEN;
        return {
          source,
          allowed: true,
          probe: true,
          report: (outcome) => { resolveProbe(failureCountFromOutcome(outcome) > 0); },
        };
      }

      // half-open: one probe is already out, so everyone else skips
      return { source, allowed: false, probe: false, report: noopReport };
    },
  };
}

/** The breakers a page (or a process) holds, one per source name, minted on
 *  first use. */
export function createSourceBreakerRegistry(options = {}) {
  const breakers = new Map();
  return {
    breakerFor(source) {
      const name = String(source ?? "");
      let breaker = breakers.get(name);
      if (!breaker) {
        breaker = createSourceBreaker({ ...options, source: name });
        breakers.set(name, breaker);
      }
      return breaker;
    },
    read() {
      return [...breakers.values()].map((breaker) => breaker.read());
    },
  };
}

let shared = null;

/** The registry every call site shares by default: page-lifetime in the
 *  browser, process-lifetime in the CLI. A source that trips its threshold in
 *  the news page's enrich cycle is therefore skipped by the chat lane too —
 *  one failing dependency, one decision about it. */
export function sourceBreakers() {
  if (!shared) shared = createSourceBreakerRegistry();
  return shared;
}

/** Drops the shared registry, so a test starts from an untouched machine. */
export function resetSourceBreakers() {
  shared = null;
}

/** Runs `work` behind `source`'s breaker. A skipped source never runs the
 *  work: it answers null, adds its name to `skipped`, and the caller's
 *  existing empty-result path takes over unchanged.
 *
 *  `systemicFailuresOf` reads the count this attempt earned — the courtesy
 *  gate's monotonic counter, diffed around the call by `throughSourceBreaker`
 *  itself. A source with no such counter reports nothing and its breaker
 *  never opens, which is the right posture for a source whose failures we
 *  cannot see. */
export async function throughSourceBreaker(source, work, {
  registry = sourceBreakers(),
  skipped = null,
  systemicFailuresOf = null,
} = {}) {
  const name = String(source ?? "");
  if (!name) return await work();
  const decision = registry.breakerFor(name).decide();
  if (!decision.allowed) {
    if (skipped && typeof skipped.add === "function") skipped.add(name);
    return null;
  }
  const before = typeof systemicFailuresOf === "function" ? Number(systemicFailuresOf()) || 0 : 0;
  try {
    return await work();
  } finally {
    const after = typeof systemicFailuresOf === "function" ? Number(systemicFailuresOf()) || 0 : 0;
    decision.report({ systemicFailures: Math.max(0, after - before) });
  }
}

/** The names read out in the order a reader can check, so the same set of
 *  skips always renders the same line. */
function listNames(sources) {
  const names = [...new Set([...(sources ?? [])].map((s) => String(s ?? "").trim()).filter(Boolean))].sort();
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The trailing line an answer carries when a skipped source changed what
 *  served it. Null when nothing was skipped, so an ordinary turn is
 *  byte-identical to a run without this seam. */
export function sourceSkipNoteLine(sources) {
  const names = listNames(sources);
  if (!names) return null;
  const many = [...new Set([...(sources ?? [])].map((s) => String(s ?? "").trim()).filter(Boolean))].length > 1;
  return many
    ? `Answered without ${names}. Those sources kept failing, so this session stopped asking them.`
    : `Answered without ${names}. That source kept failing, so this session stopped asking it.`;
}
