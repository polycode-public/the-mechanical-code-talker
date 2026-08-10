// source-breaker.test.mjs — the external sources' circuit breaker: the state
// machine over a stepped clock, what counts as a failure and what never does,
// and the line an answer carries when a skip changed what served it. No
// network anywhere: the only thing under test is the machine.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createSourceBreaker,
  createSourceBreakerRegistry,
  sourceBreakers,
  resetSourceBreakers,
  throughSourceBreaker,
  sourceSkipNoteLine,
  sourceSkipStatusLine,
  isSystemicSourceFailure,
  isSystemicSourceStatus,
  failureCountFromOutcome,
  SOURCE_BREAKER_DEFAULTS,
  SOURCE_BREAKER_CLOSED,
  SOURCE_BREAKER_OPEN,
  SOURCE_BREAKER_HALF_OPEN,
} from "../../src/domain/source-breaker.mjs";

/** A clock the test moves by hand, so a window rollover and a cooldown expiry
 *  are both exact. */
function steppedClock(start = 1_000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
}

function failTimes(breaker, count) {
  for (let i = 0; i < count; i += 1) {
    const decision = breaker.decide();
    decision.report({ systemicFailures: 1 });
  }
}

test("a closed breaker allows every lookup and stays closed while nothing fails systemically", () => {
  const breaker = createSourceBreaker({ source: "wikipedia", clock: steppedClock() });
  for (let i = 0; i < 20; i += 1) {
    const decision = breaker.decide();
    assert.equal(decision.allowed, true);
    assert.equal(decision.probe, false);
    decision.report({ systemicFailures: 0 });
  }
  assert.equal(breaker.read().state, SOURCE_BREAKER_CLOSED);
});

test("an empty result is an answer, never a failure — a source that keeps missing never opens", () => {
  const breaker = createSourceBreaker({ source: "wikidata", clock: steppedClock() });
  for (let i = 0; i < SOURCE_BREAKER_DEFAULTS.failureThreshold * 3; i += 1) {
    breaker.decide().report({ systemicFailures: 0 });
  }
  assert.equal(breaker.read().state, SOURCE_BREAKER_CLOSED);
  assert.equal(breaker.read().failures, 0);
});

test("the threshold's worth of systemic failures inside one window opens the breaker", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold - 1);
  assert.equal(breaker.read().state, SOURCE_BREAKER_CLOSED);
  failTimes(breaker, 1);
  assert.equal(breaker.read().state, SOURCE_BREAKER_OPEN);
});

test("a window that aged out resets the count instead of adding to a stale total", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold - 1);
  clock.advance(SOURCE_BREAKER_DEFAULTS.windowMs + 1);
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold - 1);
  assert.equal(breaker.read().state, SOURCE_BREAKER_CLOSED);
  assert.equal(breaker.read().failures, SOURCE_BREAKER_DEFAULTS.failureThreshold - 1);
});

test("an open breaker skips every lookup inside its cooldown", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold);

  clock.advance(SOURCE_BREAKER_DEFAULTS.cooldownMs - 1);
  const decision = breaker.decide();
  assert.equal(decision.allowed, false);
  assert.equal(decision.probe, false);
  assert.equal(breaker.read().state, SOURCE_BREAKER_OPEN);
});

test("past the cooldown exactly one caller probes; everyone else keeps skipping", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold);
  clock.advance(SOURCE_BREAKER_DEFAULTS.cooldownMs);

  const prober = breaker.decide();
  assert.equal(prober.allowed, true);
  assert.equal(prober.probe, true);
  assert.equal(breaker.read().state, SOURCE_BREAKER_HALF_OPEN);

  const other = breaker.decide();
  assert.equal(other.allowed, false);
  assert.equal(other.probe, false);
});

test("a successful probe closes the breaker and clears the failure count", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold);
  clock.advance(SOURCE_BREAKER_DEFAULTS.cooldownMs);

  breaker.decide().report({ systemicFailures: 0 });
  assert.equal(breaker.read().state, SOURCE_BREAKER_CLOSED);
  assert.equal(breaker.read().failures, 0);
  assert.equal(breaker.decide().allowed, true);
});

test("a failed probe reopens the breaker with a fresh cooldown", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold);
  clock.advance(SOURCE_BREAKER_DEFAULTS.cooldownMs);

  breaker.decide().report({ systemicFailures: 1 });
  assert.equal(breaker.read().state, SOURCE_BREAKER_OPEN);
  assert.equal(breaker.decide().allowed, false);

  clock.advance(SOURCE_BREAKER_DEFAULTS.cooldownMs);
  assert.equal(breaker.decide().probe, true);
});

test("reporting the same probe twice is ignored rather than thrown", () => {
  const clock = steppedClock();
  const breaker = createSourceBreaker({ source: "wikipedia", clock });
  failTimes(breaker, SOURCE_BREAKER_DEFAULTS.failureThreshold);
  clock.advance(SOURCE_BREAKER_DEFAULTS.cooldownMs);

  const decision = breaker.decide();
  decision.report({ systemicFailures: 0 });
  decision.report({ systemicFailures: 1 });
  assert.equal(breaker.read().state, SOURCE_BREAKER_CLOSED);
});

test("a throttle, a 5xx and a timeout count; a 404 and a plain miss do not", () => {
  assert.equal(isSystemicSourceStatus(429), true);
  assert.equal(isSystemicSourceStatus(503), true);
  assert.equal(isSystemicSourceStatus(408), true);
  assert.equal(isSystemicSourceStatus(404), false);
  assert.equal(isSystemicSourceStatus(200), false);

  assert.equal(isSystemicSourceFailure({ name: "AbortError" }), true);
  assert.equal(isSystemicSourceFailure({ status: 500 }), true);
  assert.equal(isSystemicSourceFailure({ status: 404 }), false);
  assert.equal(isSystemicSourceFailure(null), false);

  assert.equal(failureCountFromOutcome(3), 3);
  assert.equal(failureCountFromOutcome({ systemicFailures: 2 }), 2);
  assert.equal(failureCountFromOutcome({ error: { name: "AbortError" } }), 1);
  assert.equal(failureCountFromOutcome({ error: { status: 404 } }), 0);
  assert.equal(failureCountFromOutcome(null), 0);
});

test("each source in a registry breaks on its own; one failing source never skips another", () => {
  const clock = steppedClock();
  const registry = createSourceBreakerRegistry({ clock });
  failTimes(registry.breakerFor("wikidata"), SOURCE_BREAKER_DEFAULTS.failureThreshold);

  assert.equal(registry.breakerFor("wikidata").decide().allowed, false);
  assert.equal(registry.breakerFor("wikipedia").decide().allowed, true);
  assert.equal(registry.breakerFor("wikidata"), registry.breakerFor("wikidata"));
});

test("throughSourceBreaker runs the work, counts only the systemic failures it saw, and skips once open", async () => {
  const clock = steppedClock();
  const registry = createSourceBreakerRegistry({ clock });
  let systemicFailures = 0;
  let calls = 0;
  const skipped = new Set();

  const lookup = (failed) => throughSourceBreaker("wikipedia", async () => {
    calls += 1;
    if (failed) systemicFailures += 1;
    return failed ? null : { term: "quasar" };
  }, { registry, skipped, systemicFailuresOf: () => systemicFailures });

  assert.deepEqual(await lookup(false), { term: "quasar" });
  for (let i = 0; i < SOURCE_BREAKER_DEFAULTS.failureThreshold; i += 1) assert.equal(await lookup(true), null);
  const callsBeforeSkip = calls;

  assert.equal(await lookup(false), null);
  assert.equal(calls, callsBeforeSkip, "a skipped source is never called");
  assert.deepEqual([...skipped], ["wikipedia"]);
});

test("throughSourceBreaker leaves a source whose failures it cannot see closed", async () => {
  const registry = createSourceBreakerRegistry({ clock: steppedClock() });
  for (let i = 0; i < SOURCE_BREAKER_DEFAULTS.failureThreshold * 2; i += 1) {
    await throughSourceBreaker("wiktionary", async () => null, { registry });
  }
  assert.equal(registry.breakerFor("wiktionary").read().state, SOURCE_BREAKER_CLOSED);
});

test("the shared registry is one machine per session, and resetting mints a fresh one", () => {
  resetSourceBreakers();
  const first = sourceBreakers();
  assert.equal(sourceBreakers(), first);
  failTimes(first.breakerFor("wikipedia"), SOURCE_BREAKER_DEFAULTS.failureThreshold);
  assert.equal(sourceBreakers().breakerFor("wikipedia").decide().allowed, false);

  resetSourceBreakers();
  assert.notEqual(sourceBreakers(), first);
  assert.equal(sourceBreakers().breakerFor("wikipedia").decide().allowed, true);
  resetSourceBreakers();
});

test("the skip note names the sources, reads the same for any order, and is null when nothing was skipped", () => {
  assert.equal(sourceSkipNoteLine([]), null);
  assert.equal(sourceSkipNoteLine(null), null);
  assert.equal(
    sourceSkipNoteLine(["wikipedia"]),
    "Answered without wikipedia. That source kept failing, so this session stopped asking it.",
  );
  assert.equal(
    sourceSkipNoteLine(["wikidata", "wikipedia"]),
    "Answered without wikidata and wikipedia. Those sources kept failing, so this session stopped asking them.",
  );
  assert.equal(sourceSkipNoteLine(["wikipedia", "wikidata"]), sourceSkipNoteLine(["wikidata", "wikipedia"]));
  assert.equal(sourceSkipNoteLine(["wikipedia", "wikipedia"]), sourceSkipNoteLine(["wikipedia"]));
});

test("a cycle reports the same skip as a status rather than as an answer", () => {
  assert.equal(sourceSkipStatusLine([]), null);
  assert.equal(
    sourceSkipStatusLine(["wikidata"]),
    "Skipped wikidata. That source kept failing, so this session stopped asking it.",
  );
  assert.equal(
    sourceSkipStatusLine(["wiktionary", "wikidata"]),
    "Skipped wikidata and wiktionary. Those sources kept failing, so this session stopped asking them.",
  );
});
