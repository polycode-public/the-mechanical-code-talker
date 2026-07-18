// The 10-second tier's lane sample: the first row of every chat lane, driven through
// the lane runner itself rather than copied into this file.
//
// A sample, not a pin. The lanes remain the pins — all 784 rows of them — and this
// tier makes no claim to cover them. Its job is to catch the gross break: a lane
// runner that throws, a session that will not start, a teach path that stopped
// storing. Driving the real runner (rather than transcribing rows here) means the
// sample cannot drift away from what the lanes actually assert.
//
// bench-smoke is left out on purpose: its rows spawn real benchmark scripts and cost
// ~370ms each, which is the one thing this tier cannot afford.
import { test } from "node:test";
import { readLaneRows, runChatRow, lanePredicates } from "../corpus/run-lane.mjs";

const LANES = [
  "grammar",
  "inference",
  "planning",
  "templates",
  "games/compositional",
  "games/drilldowns",
  "games/guess-number",
  "games/messy-user",
  "games/openers",
  "games/relation-touches",
  "games/teach-recall",
];

for (const lane of LANES) {
  test(`the ${lane} lane's first row still answers as the lane says it does`, async () => {
    const rows = readLaneRows(lane);
    const row = rows.find((r) => r.turns);
    if (!row) return; // a lane of bench rows only — nothing for this tier to drive
    await runChatRow(row, await lanePredicates(lane));
  });
}
