#!/usr/bin/env node
// compare-prey-decision.mjs — run the town square twice per seed, once with the
// prey's strict evade-before-forage priority chain and once with the weighted
// score behind `blendPreyDecision`, and print what separates them.
//
// The engine has no benchmark harness of its own, so this is one: N fixed
// seeds, M turns each, the same starting roster on both sides of every seed.
// A seed is an EPOCH, which is the slot the engine's own seedKey already
// carries (`${layoutName}:${epoch}:${turn}:${id}:${purpose}`), so two seeds
// draw genuinely different spawn and wander cells out of one keyspace rather
// than a second one invented here.
//
// Two measures, and both are needed:
//
//   1. Survival — turns from arrival to eaten or starved, per prey id. The
//      whole per-seed distribution is kept and printed, never only the mean: a
//      mode can win on average and lose badly in its tail, and a mean hides
//      exactly that.
//   2. Foraging under threat — the share of prey decisions taken with a
//      predator standing within N cells that closed on food rather than fled.
//      Survival alone would happily reward a blend that survives by never
//      foraging at all, which is the wrong hypothesis and a worse demo. This
//      number says whether that is what happened.
//
// Deterministic end to end: no wall clock, no Math.random, no network. The
// same arguments print the same report.
//
//   node scripts/compare-prey-decision.mjs
//   node scripts/compare-prey-decision.mjs --seeds=12 --turns=200
//   node scripts/compare-prey-decision.mjs --weights=0.3,0.5,0.7 --json
//   node scripts/compare-prey-decision.mjs --set=preyMassDecrementPerTurn=0.25

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTownSquareTick, startTownSquareGame, townSquareBoard,
} from "../src/services/predator-prey.mjs";
import {
  TOWN_SQUARE_LAYOUTS, chebyshevDistance, parseCellId, worldFactRows,
} from "../src/domain/town-square-world.mjs";
import { appendFacts } from "../src/adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG } from "../src/domain/game-config.mjs";

const DEFAULTS = Object.freeze({
  layout: "town-square",
  seeds: 12,
  turns: 200,
  weights: [DEFAULT_GAME_CONFIG.mudiii.preyThreatWeight],
});

// The bands the behavioural metric reports. The widest is a prey's own vision
// radius, so "a predator within that many cells" and "a predator this prey can
// see" are the same statement — vision here is plain Chebyshev with no line of
// sight. The tighter bands separate a crumb taken at arm's length from one
// taken at the edge of sight, which is the difference between a blend that is
// reckless and one that is merely opportunistic.
const threatBandsFor = (config) => {
  const widest = config.preyVisionRadius;
  return [...new Set([1, 2, widest])].filter((n) => n <= widest).sort((a, b) => a - b);
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS, json: false, overrides: {} };
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    const raw = rest.length ? rest.join("=") : undefined;
    if (key === "json") { opts.json = true; continue; }
    if (raw === undefined) throw new Error(`compare-prey-decision: "${arg}" needs a value, as --${key}=<value>`);
    if (key === "layout") opts.layout = raw;
    else if (key === "seeds") opts.seeds = Number(raw);
    else if (key === "turns") opts.turns = Number(raw);
    else if (key === "weights") opts.weights = raw.split(",").map(Number);
    else if (key === "set") {
      // Both modes get the same override, so it changes the regime under test
      // rather than either side of the comparison. The one it was built for:
      // on the shipped drain nothing ever starves inside a run, so food has no
      // survival value to trade against and the measure cannot see the
      // question. A drain that starves an unfed prey inside a normal lifetime
      // makes the trade real.
      const [name, value] = raw.split("=");
      if (!(name in DEFAULT_GAME_CONFIG.mudiii)) throw new Error(`compare-prey-decision: no mudiii key named "${name}"`);
      opts.overrides[name] = Number.isNaN(Number(value)) ? value : Number(value);
    } else throw new Error(`compare-prey-decision: no such option "--${key}"`);
  }
  if (!Number.isInteger(opts.seeds) || opts.seeds < 1) throw new Error("--seeds must be a positive integer");
  if (!Number.isInteger(opts.turns) || opts.turns < 1) throw new Error("--turns must be a positive integer");
  for (const w of opts.weights) {
    if (!Number.isFinite(w) || w < 0 || w > 1) throw new Error(`--weights values run 0 to 1; got ${w}`);
  }
  return opts;
}

/** One run of `turns` ticks on `layout` at seed index `seed`, under `config`.
 *
 *  Returns the per-prey survival records and the decision counts the two
 *  measures are built from. Every prey that was ever on the board gets a
 *  record, including the ones still alive at the end — those are marked
 *  `censored`, because "lived at least this long" is not the same claim as
 *  "lived exactly this long" and averaging them together silently would be a
 *  third, untrue one. */
async function playOneRun({ layout, seed, turns, config }) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-prey-compare-s${seed}-`));
  try {
    await appendFacts(dir, [...worldFactRows(layout)].map((f) => ({
      subject: f.subject, predicate: f.predicate, object: f.object, provenance: `world:${layout.name}`,
    })));
    const started = await startTownSquareGame(dir, { layout, config, epoch: seed });

    const bands = threatBandsFor(config);
    const life = new Map(); // prey id -> { bornTurn, endTurn, fate }
    const decisions = new Map(bands.map((n) => [n, { total: 0, contested: 0, forage: 0, evade: 0, other: 0 }]));
    let crumbsEaten = 0;

    const board = await townSquareBoard(dir, { layout, config });
    for (const [id, agent] of Object.entries(board.agents)) {
      if (agent.role === "prey") life.set(id, { bornTurn: 0, endTurn: null, fate: "alive" });
    }
    let standing = new Map(Object.entries(board.agents).map(([id, a]) => [id, { role: a.role, cell: parseCellId(a.cell) }]));
    let lying = Object.values(board.items).map((item) => parseCellId(item.cell));

    for (let turn = 1; turn <= turns; turn += 1) {
      // Where everything stood when this turn's decisions were taken. Prey
      // believe the PRE-move predator cells, so these are the exact positions
      // the chain or the score read.
      const predatorCells = [...standing.values()].filter((a) => a.role === "predator").map((a) => a.cell);
      const preyCells = new Map([...standing].filter(([, a]) => a.role === "prey").map(([id, a]) => [id, a.cell]));
      const foodCells = lying;

      const tick = await runTownSquareTick(dir, { layout, config });

      for (const [id, cell] of preyCells) {
        const rung = tick.rungs[id];
        if (!rung) continue;
        const nearest = Math.min(...predatorCells.map((p) => chebyshevDistance(cell.x, cell.y, p.x, p.y)));
        // Food vision is gated at the same radius and there are no told facts
        // in this harness, so "a crumb within the radius" and "a crumb this
        // prey believes in" are the same set. A turn where the prey believes
        // both is the only kind the two modes can decide differently, which is
        // what makes this count the ceiling on the whole comparison.
        const seesFood = foodCells.some((f) => chebyshevDistance(cell.x, cell.y, f.x, f.y) <= config.preyVisionRadius);
        for (const n of bands) {
          if (nearest > n) continue;
          const row = decisions.get(n);
          row.total += 1;
          if (seesFood) row.contested += 1;
          if (rung === "forage") row.forage += 1;
          else if (rung === "evade") row.evade += 1;
          else row.other += 1;
        }
      }

      for (const event of tick.ecology) {
        if (event.type === "spawn-prey") life.set(event.agent, { bornTurn: turn, endTurn: null, fate: "alive" });
        else if (event.type === "eat-item") crumbsEaten += 1;
        else if (event.type === "eat-agent") {
          const record = life.get(event.prey);
          if (record) { record.endTurn = turn; record.fate = "eaten"; }
        } else if (event.type === "starve") {
          const record = life.get(event.agent);
          if (record) { record.endTurn = turn; record.fate = "starved"; }
        }
      }

      standing = new Map(Object.entries(tick.agents).map(([id, a]) => [id, { role: a.role, cell: parseCellId(a.cell) }]));
      lying = Object.values(tick.items).map((item) => parseCellId(item.cell));
    }

    const survival = [...life.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, record]) => ({
      id,
      bornTurn: record.bornTurn,
      fate: record.fate,
      censored: record.fate === "alive",
      lifespan: (record.endTurn ?? turns) - record.bornTurn,
    }));

    return {
      seed,
      rosterKey: rosterKeyOf(started.facts),
      survival,
      crumbsEaten,
      decisions: Object.fromEntries([...decisions].map(([n, row]) => [n, row])),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A one-line fingerprint of the starting roster, so "both modes started from
 *  the same board" is checked rather than assumed. */
const rosterKeyOf = (facts) => facts
  .filter((f) => f.predicate === "mgx:currently-in")
  .map((f) => `${f.subject}=${f.object}`)
  .sort()
  .join(" ");

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** Every seed's records folded into the numbers the report prints. Deaths and
 *  censored survivors are summarized apart as well as together: a run where one
 *  mode simply keeps more prey alive to the final turn moves the combined mean
 *  without any prey actually living longer. */
function summarize(runs) {
  const all = runs.flatMap((r) => r.survival);
  const deaths = all.filter((r) => !r.censored);
  const deathSpans = deaths.map((r) => r.lifespan).sort((a, b) => a - b);
  const allSpans = all.map((r) => r.lifespan).sort((a, b) => a - b);
  const bands = Object.keys(runs[0].decisions).map(Number).sort((a, b) => a - b);
  return {
    preyCount: all.length,
    deathCount: deaths.length,
    eatenCount: deaths.filter((r) => r.fate === "eaten").length,
    starvedCount: deaths.filter((r) => r.fate === "starved").length,
    aliveAtEnd: all.length - deaths.length,
    meanLifespan: mean(allSpans),
    medianLifespan: quantile(allSpans, 0.5),
    worstDecile: quantile(allSpans, 0.1),
    minLifespan: allSpans[0] ?? 0,
    maxLifespan: allSpans[allSpans.length - 1] ?? 0,
    meanDeathLifespan: mean(deathSpans),
    medianDeathLifespan: quantile(deathSpans, 0.5),
    totalPreyTurns: sum(allSpans),
    crumbsEaten: sum(runs.map((r) => r.crumbsEaten)),
    forageUnderThreat: Object.fromEntries(bands.map((n) => {
      const total = sum(runs.map((r) => r.decisions[n].total));
      const contested = sum(runs.map((r) => r.decisions[n].contested));
      const forage = sum(runs.map((r) => r.decisions[n].forage));
      return [n, {
        total, contested, forage,
        rate: total ? forage / total : 0,
        contestedRate: contested ? forage / contested : 0,
      }];
    })),
  };
}

const pad = (text, width) => String(text).padStart(width);
const fixed = (n, places = 1) => n.toFixed(places);
const percent = (rate) => `${fixed(rate * 100, 1)}%`;

function printReport(report) {
  const { layout, turns, seeds, modes, overrides } = report;
  console.log(`prey decision comparison — layout ${layout}, ${seeds.length} seeds x ${turns} turns, ${modes.length} modes`);
  const overridden = Object.entries(overrides);
  if (overridden.length) console.log(`config overrides (applied to every mode): ${overridden.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`seeds: ${seeds.join(", ")} (each seed is an epoch, and the engine's seed keys carry it)`);
  console.log("");

  console.log("per-seed survival (lifespan in turns per prey id; * = still alive at the final turn)");
  for (const seed of seeds) {
    console.log(`  seed ${seed}`);
    for (const mode of modes) {
      const run = mode.runs.find((r) => r.seed === seed);
      const spans = run.survival
        .map((r) => `${r.lifespan}${r.censored ? "*" : ""}`)
        .join(" ");
      const spanValues = run.survival.map((r) => r.lifespan).sort((a, b) => a - b);
      console.log(`    ${mode.label.padEnd(22)} n=${pad(run.survival.length, 2)} mean=${pad(fixed(mean(spanValues)), 6)} med=${pad(fixed(quantile(spanValues, 0.5)), 6)} min=${pad(spanValues[0] ?? 0, 4)} max=${pad(spanValues[spanValues.length - 1] ?? 0, 4)}`);
      console.log(`      ${spans}`);
    }
  }
  console.log("");

  console.log("aggregate survival");
  console.log(`  ${"mode".padEnd(22)} ${pad("prey", 5)} ${pad("mean", 7)} ${pad("median", 7)} ${pad("p10", 6)} ${pad("min", 5)} ${pad("max", 5)} ${pad("eaten", 6)} ${pad("starved", 8)} ${pad("alive", 6)}`);
  for (const mode of modes) {
    const s = mode.summary;
    console.log(`  ${mode.label.padEnd(22)} ${pad(s.preyCount, 5)} ${pad(fixed(s.meanLifespan), 7)} ${pad(fixed(s.medianLifespan), 7)} ${pad(fixed(s.worstDecile), 6)} ${pad(s.minLifespan, 5)} ${pad(s.maxLifespan, 5)} ${pad(s.eatenCount, 6)} ${pad(s.starvedCount, 8)} ${pad(s.aliveAtEnd, 6)}`);
  }
  console.log("");

  console.log("deaths only (censored survivors excluded, so a mode cannot win by keeping prey alive past the last turn)");
  console.log(`  ${"mode".padEnd(22)} ${pad("deaths", 7)} ${pad("mean", 7)} ${pad("median", 7)}`);
  for (const mode of modes) {
    const s = mode.summary;
    console.log(`  ${mode.label.padEnd(22)} ${pad(s.deathCount, 7)} ${pad(fixed(s.meanDeathLifespan), 7)} ${pad(fixed(s.medianDeathLifespan), 7)}`);
  }
  console.log("");

  const bands = Object.keys(modes[0].summary.forageUnderThreat).map(Number).sort((a, b) => a - b);
  console.log("foraging under threat (share of prey decisions taken with a predator within N cells that closed on food)");
  console.log(`  ${"mode".padEnd(22)} ${bands.map((n) => pad(`N<=${n}`, 16)).join(" ")} ${pad("crumbs eaten", 13)}`);
  for (const mode of modes) {
    const cells = bands.map((n) => {
      const band = mode.summary.forageUnderThreat[n];
      return pad(`${percent(band.rate)} (${band.forage}/${band.total})`, 16);
    });
    console.log(`  ${mode.label.padEnd(22)} ${cells.join(" ")} ${pad(mode.summary.crumbsEaten, 13)}`);
  }
  console.log("");

  // The two modes only ever decide differently on a turn where the prey
  // believes a predator AND food. Every number above is bounded by how often
  // that happens, so it is printed rather than left to be inferred.
  console.log("contested decisions (a predator within N cells AND food believed — the only turns the modes can differ on)");
  console.log(`  ${"mode".padEnd(22)} ${bands.map((n) => pad(`N<=${n}`, 22)).join(" ")}`);
  for (const mode of modes) {
    const cells = bands.map((n) => {
      const band = mode.summary.forageUnderThreat[n];
      return pad(`${band.contested}/${band.total}, took ${percent(band.contestedRate)}`, 22);
    });
    console.log(`  ${mode.label.padEnd(22)} ${cells.join(" ")}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const layout = TOWN_SQUARE_LAYOUTS[opts.layout];
  if (!layout) throw new Error(`compare-prey-decision: no such layout "${opts.layout}" (have ${Object.keys(TOWN_SQUARE_LAYOUTS).join(", ")})`);

  const base = { ...DEFAULT_GAME_CONFIG.mudiii, ...opts.overrides };
  const modeSpecs = [
    { label: "priority chain", config: { ...base, blendPreyDecision: false } },
    ...opts.weights.map((w) => ({ label: `blend w=${w}`, config: { ...base, blendPreyDecision: true, preyThreatWeight: w } })),
  ];

  const seeds = Array.from({ length: opts.seeds }, (_, i) => i);
  const modes = [];
  for (const spec of modeSpecs) {
    const runs = [];
    for (const seed of seeds) {
      runs.push(await playOneRun({ layout, seed, turns: opts.turns, config: spec.config }));
    }
    modes.push({ ...spec, runs, summary: summarize(runs) });
  }

  // Both modes must have started each seed from the same board, or nothing
  // below compares anything.
  for (const seed of seeds) {
    const keys = new Set(modes.map((m) => m.runs.find((r) => r.seed === seed).rosterKey));
    if (keys.size !== 1) throw new Error(`seed ${seed}: the modes started from different rosters`);
  }

  const report = {
    layout: layout.name,
    turns: opts.turns,
    overrides: opts.overrides,
    seeds,
    modes: modes.map((m) => ({ label: m.label, config: m.config, runs: m.runs, summary: m.summary })),
  };
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

await main();
