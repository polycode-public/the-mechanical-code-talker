// corpus-matrix.mjs — the fold and the two gap heuristics behind the
// capability-by-lane coverage matrix, plus the table renderer. Pure: rows in,
// counts and text out, so the heuristics can be tested against a handful of
// made-up rows instead of whatever test/corpus happens to hold today.
//
// scripts/corpus-matrix.mjs keeps the readdir, the readFile and the printing.

/** A row's capability group: the first two dot-segments of its key, so
 *  "ask.alias.two-hop" and "ask.alias.miss" are one capability. */
export const groupOfKey = (key) => key.split(".").slice(0, 2).join(".");

/** The key a row is counted under. A row with no key is still a row, and
 *  hiding it would understate the lane. */
export const keyOfRow = (row) => String(row.key ?? "(no key)");

/** A key segment naming a miss, a guard or a negation — the row that pins what
 *  a capability DECLINES to do, as opposed to its happy path. */
const NEGATIVE_RE = /(honest-miss|miss|guard|negation|negative|never|decline|refus|unsolvable|unknown|hedge|no-antecedent|untouched|empty)/;

export const isNegativeKey = (key) => NEGATIVE_RE.test(key);

/** Fold `{ lane, row }` pairs into the two indexes every view needs: the count
 *  per group per lane, and the full keys each group was built from. */
export function tallyRows(entries) {
  const counts = new Map(); // group -> Map<lane, rowCount>
  const fullKeys = new Map(); // group -> Set<full key>
  for (const { lane, row } of entries) {
    const key = keyOfRow(row);
    const group = groupOfKey(key);
    if (!counts.has(group)) counts.set(group, new Map());
    const perLane = counts.get(group);
    perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
    if (!fullKeys.has(group)) fullKeys.set(group, new Set());
    fullKeys.get(group).add(key);
  }
  return { counts, fullKeys };
}

/** The groups the gap heuristics judge. bench.* rows assert a rig runs rather
 *  than pinning a capability, so "no negative row" says nothing there. */
export const behaviourGroups = ({ counts }) =>
  [...counts.keys()].filter((g) => !g.startsWith("bench.")).sort();

const rowTotal = (counts, group) => [...counts.get(group).values()].reduce((a, b) => a + b, 0);

/** Groups a single row pins end to end. A review candidate, not a hole. */
export function thinGroups(tally) {
  return behaviourGroups(tally).filter((g) => rowTotal(tally.counts, g) === 1);
}

/** Groups whose keys never name a miss, guard or negation — a happy path is
 *  pinned and the decline is not. A review candidate, not a hole. */
export function groupsWithNoNegativeRow(tally) {
  return behaviourGroups(tally).filter((g) => ![...tally.fullKeys.get(g)].some(isNegativeKey));
}

/** The lanes a group has rows in, in the order given. */
export const lanesOfGroup = ({ counts }, group) => [...counts.get(group).keys()];

/** One row per group, one column per lane, an empty cell where a lane has no
 *  row for that group. The header row comes first. */
export function matrixRows({ counts }, lanes) {
  const groups = [...counts.keys()].sort();
  return [
    ["key", ...lanes],
    ...groups.map((group) => [
      group,
      ...lanes.map((lane) => {
        const n = counts.get(group).get(lane);
        return n ? String(n) : "";
      }),
    ]),
  ];
}

/** `rows` (header first) as fixed-width text, with a rule under the header.
 *  Each column is as wide as its widest cell; trailing padding is trimmed. */
export function renderTable(rows) {
  const [header, ...body] = rows;
  const widths = header.map((h, col) => Math.max(h.length, ...body.map((r) => r[col].length)));
  const renderLine = (cells) => cells.map((c, col) => c.padEnd(widths[col])).join("  ").trimEnd();
  return [
    renderLine(header),
    renderLine(widths.map((w) => "-".repeat(w))),
    ...body.map(renderLine),
  ].join("\n");
}
