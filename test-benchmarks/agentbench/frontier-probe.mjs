// agentbench/frontier-probe.mjs — the MEASUREMENT INSTRUMENT for what sits past
// the graded ladder. Not a test tier, not part of cases.jsonl, and nothing
// imports it: run it by hand when a cycle needs evidence the graded case set
// cannot carry.
//
//   node test-benchmarks/agentbench/frontier-probe.mjs
//
// grade.mjs's RUNGS stops at TOOL-8, so TOOL-9 (goal recognition) and TOOL-10
// (open-world relevance) have no expect-shape and no cases. This probe drives
// the same goal driver over requests shaped like those two rungs and prints
// what came back, so a cycle can report whether the frontier behaviour is an
// honest refusal or a confident answer to a question nobody asked.
//
// It carries three sections:
//   1. FRONTIER   — TOOL-9 / TOOL-10 shaped requests, classified by hand.
//   2. GENERALIZE — held-out TOOL-7 recovery and TOOL-8 tied-candidate cases,
//                   checking those two capabilities are wider than the 3 cases
//                   each rung carries, with negative controls.
//   3. BOUND      — the member-filter step budget against the real-repo fixture,
//                   showing what the router declines beside what the same
//                   module's fold already computes.
//
// Deterministic: no Date.now, no network, no LLM. Two runs print the same bytes.

import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRunCtx } from "./run.mjs";
import { goalDriver } from "./driver-goal.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { membersReaching } from "../../src/domain/router/results.mjs";
import { MAX_STEPS } from "../../src/domain/router/planner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const LARGE_SCALE_GRAPH = join(ROOT, "test", "fixtures", "large-scale", ".tmct", "graph.json");

// ---- 1. FRONTIER: TOOL-9 and TOOL-10 shaped requests -------------------------
//
// TOOL-9 asks the driver to RECOGNIZE a goal from a narrated action trace and
// confirm it against the bounded declared set (GOAL_RULES + a reject class).
// TOOL-10 asks it to plan when the facts the request turns on are undeclared.
const FRONTIER = Object.freeze([
  { id: "p9-trace-coverage", rung: "TOOL-9", expectShape: "recognize coverage-invariant",
    request: "I ran the impact of app/lib/a.mjs and then listed the untested modules. what am I trying to do",
    tools: ["tmct_impact", "tmct_untested"] },
  { id: "p9-trace-coverage-2", rung: "TOOL-9", expectShape: "recognize coverage-invariant",
    request: "someone called tmct_impact on app/lib/f.mjs then tmct_untested. what goal does that serve",
    tools: ["tmct_impact", "tmct_untested"] },
  { id: "p9-trace-cochange", rung: "TOOL-9", expectShape: "recognize cochange-risk-invariant",
    request: "I looked at the cochanges of app/lib/a.mjs and then the untested modules. what goal is that",
    tools: ["tmct_cochanges", "tmct_untested"] },
  { id: "p9-trace-reject", rung: "TOOL-9", expectShape: "reject class (no declared goal fits)",
    request: "I described Widget and then listed its subclasses. what am I trying to do",
    tools: ["tmct_describe", "tmct_subclasses"] },
  { id: "p9-trace-partial", rung: "TOOL-9", expectShape: "recognize from a partial trace",
    request: "I just ran the untested scan. what goal am I part way through",
    tools: ["tmct_untested", "tmct_impact"] },
  { id: "p9-trace-confirm", rung: "TOOL-9", expectShape: "confirm a named goal against the trace",
    request: "am I checking coverage risk if I run impact on app/lib/c.mjs then the untested scan",
    tools: ["tmct_impact", "tmct_untested"] },

  { id: "p10-sprint", rung: "TOOL-10", expectShape: "bound the relevant set or miss-wall on the ship date",
    request: "which module should I refactor first given we ship on Friday",
    tools: ["tmct_impact", "tmct_untested"] },
  { id: "p10-owner", rung: "TOOL-10", expectShape: "miss-wall naming that ownership is undeclared",
    request: "who owns app/lib/a.mjs and should they review my change",
    tools: ["tmct_describe", "tmct_impact"] },
  { id: "p10-perf", rung: "TOOL-10", expectShape: "miss-wall naming that runtime behaviour is undeclared",
    request: "is app/lib/a.mjs slow in production",
    tools: ["tmct_impact", "tmct_describe"] },
  { id: "p10-partial-world", rung: "TOOL-10", expectShape: "answer the grounded half, name the dropped qualifier",
    request: "is app/lib/a.mjs safe to change given the flaky tests",
    tools: ["tmct_impact", "tmct_untested"] },
  { id: "p10-security", rung: "TOOL-10", expectShape: "miss-wall naming that vulnerability data is undeclared",
    request: "does app/lib/b.mjs have a security vulnerability",
    tools: ["tmct_describe", "tmct_impact"] },
  { id: "p10-cost", rung: "TOOL-10", expectShape: "miss-wall naming that effort/cost is undeclared",
    request: "what will it cost to test everything app/lib/a.mjs touches",
    tools: ["tmct_impact", "tmct_untested"] },
]);

// ---- 2. GENERALIZE: held-out TOOL-7 / TOOL-8, with negative controls ----------
const GENERALIZE = Object.freeze([
  { id: "g7-members-base", rung: "TOOL-7", control: false,
    request: "list the members of Base, and if there are none, describe it instead",
    tools: ["tmct_members", "tmct_describe"] },
  { id: "g7-subclasses-button", rung: "TOOL-7", control: false,
    request: "list the subclasses of Button, and if it has none, list its members instead",
    tools: ["tmct_subclasses", "tmct_members"] },
  { id: "g7-exports-c", rung: "TOOL-7", control: false,
    request: "show the exports of app/lib/c.mjs, and if there are none, show its impact instead",
    tools: ["tmct_exports", "tmct_impact"] },
  // negative controls: the primary returns something, so the fallback must NOT fire
  { id: "g7-control-widget-members", rung: "TOOL-7", control: true,
    request: "list the members of Widget, and if there are none, describe it instead",
    tools: ["tmct_members", "tmct_describe"] },
  { id: "g7-control-tests-b", rung: "TOOL-7", control: true,
    request: "show what covers app/lib/b.mjs, and if nothing does, show its impact instead",
    tools: ["tmct_tests_for", "tmct_impact"] },

  { id: "g8-b-tests", rung: "TOOL-8", control: false, request: "what tests b", tools: ["tmct_tests_for"] },
  { id: "g8-b-exports", rung: "TOOL-8", control: false, request: "what does b export", tools: ["tmct_exports"] },
  { id: "g8-b-cochange", rung: "TOOL-8", control: false, request: "what change-couples with b", tools: ["tmct_cochanges"] },
  { id: "g8-b-describe", rung: "TOOL-8", control: false, request: "describe b", tools: ["tmct_describe"] },
  { id: "g8-underspec-refactor", rung: "TOOL-8", control: false, request: "refactor the messy parts", tools: ["tmct_untested", "tmct_impact"] },
]);

const callText = (calls) =>
  calls.map((c) => `${c.name}(${JSON.stringify(c.input ?? {})})`).join(" -> ") || "«none»";

function classify(result, declaredTools) {
  const calls = result?.calls ?? [];
  const outOfSet = calls.filter((c) => !declaredTools.has(c.name)).map((c) => c.name);
  if (outOfSet.length) return { label: `HALLUCINATED-TOOL (${outOfSet.join(",")})`, outOfSet };
  if (result?.refused) return { label: result.candidateResults ? "REFUSED + candidateResults" : "REFUSED (bare)", outOfSet };
  if (calls.length) return { label: "ANSWERED", outOfSet };
  return { label: "NO CALL, NO REFUSAL", outOfSet };
}

async function runProbeSet(title, probes, ctx) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
  const tally = { refused: 0, answered: 0, hallucinated: 0, neither: 0 };
  for (const p of probes) {
    let result;
    try {
      result = await goalDriver(p.request, p.tools, ctx);
    } catch (e) {
      result = { error: String(e && e.message) };
    }
    const declared = new Set(p.tools);
    const { label, outOfSet } = classify(result, declared);
    if (outOfSet.length) tally.hallucinated += 1;
    else if (result?.refused) tally.refused += 1;
    else if ((result?.calls ?? []).length) tally.answered += 1;
    else tally.neither += 1;

    console.log(`\n[${p.rung}] ${p.id}${p.control ? " (negative control)" : ""} — ${label}`);
    console.log(`  request : ${p.request}`);
    if (p.expectShape) console.log(`  wanted  : ${p.expectShape}`);
    console.log(`  driver  : ${result?.driver}   recovered: ${result?.recovered === true}`);
    console.log(`  calls   : ${callText(result?.calls ?? [])}`);
    if (result?.candidateResults) console.log(`  tied    : ${callText(result.candidateResults)}`);
    if (result?.composed !== undefined) console.log(`  composed: ${JSON.stringify(result.composed)}`);
    const why = Array.isArray(result?.why) ? result.why : (result?.why ? [result.why] : []);
    if (why.length) console.log(`  why     : ${why.join(" | ")}`);
    if (result?.error) console.log(`  error   : ${result.error}`);
  }
  console.log(`\n  tally over ${probes.length}: refused ${tally.refused}, answered ${tally.answered}, out-of-set tool ${tally.hallucinated}, neither ${tally.neither}`);
  return tally;
}

/** Count each class's CALLABLE members in a parsed graph, the same grain
 *  drive.mjs's member-filter budget check counts. */
function callableMembersByClass(graph) {
  const callable = new Set(["Method", "Function"]);
  const counts = new Map();
  for (const group of graph.relations) {
    if (group.predicate !== "contains") continue;
    for (const edge of group.edges || []) {
      const owner = graph.byId.get(edge.subject);
      const member = graph.byId.get(edge.object);
      if (!owner || owner.class !== "Class") continue;
      if (!member || !callable.has(member.class)) continue;
      counts.set(owner.label, (counts.get(owner.label) || 0) + 1);
    }
  }
  return counts;
}

function runBoundProbe() {
  console.log(`\n${"=".repeat(78)}\n3. BOUND — the member-filter step budget on the real-repo fixture\n${"=".repeat(78)}`);
  if (!fs.existsSync(LARGE_SCALE_GRAPH)) {
    console.log(`  skipped: ${LARGE_SCALE_GRAPH} is not present`);
    return;
  }
  const graph = parseEntities(JSON.parse(fs.readFileSync(LARGE_SCALE_GRAPH, "utf8")));
  const counts = [...callableMembersByClass(graph).entries()].sort((a, b) => b[1] - a[1]);
  const callTargets = new Set();
  for (const group of graph.relations) {
    if (group.predicate !== "callsSymbol") continue;
    for (const edge of group.edges || []) callTargets.add(edge.objectLabel);
  }

  let over = 0;
  for (const [label, n] of counts) {
    const steps = 1 + n;
    const refuses = steps > MAX_STEPS;
    if (refuses) over += 1;
    console.log(`\n  ${label}: ${n} callable members => a ${steps}-step plan against a budget of ${MAX_STEPS} => router ${refuses ? "REFUSES" : "answers"}`);
    const classInd = graph.individuals.find((i) => i.label === label && i.class === "Class");
    let shown = 0;
    for (const target of callTargets) {
      if (shown >= 2) break;
      const reached = membersReaching(graph, classInd, target);
      if (!reached.length) continue;
      console.log(`    membersReaching(${label}, "${target}") already folds ${reached.length} member(s): ${reached.slice(0, 4).join(", ")}${reached.length > 4 ? ", …" : ""}`);
      shown += 1;
    }
    if (!shown) console.log("    membersReaching folds nothing for any recorded call target");
  }
  console.log(`\n  ${over} of ${counts.length} classes with callable members trip the budget while the fold still computes.`);
}

const { ctx, cleanup } = await createRunCtx();
try {
  await runProbeSet("1. FRONTIER — TOOL-9 (goal recognition) and TOOL-10 (open-world relevance)", FRONTIER, ctx);
  await runProbeSet("2. GENERALIZE — held-out TOOL-7 recovery and TOOL-8 tied candidates", GENERALIZE, ctx);
} finally {
  await cleanup();
}
runBoundProbe();
