// planner-worker.mjs — runs exactly one solvePlannerInstance() call and
// prints its result as JSON on stdout. claim-planner.mjs spawns this as a
// child process per timed run (see runIsolatedInstance there) so a runaway
// instance — one whose bounded search still allocates enough memory to
// exhaust the heap before it returns — crashes this one child rather than
// the whole sweep. A domain with no clearing precondition (gripper) or none
// of hanoi's size ordering (blocksworld) has a strictly larger legal-move
// set than hanoi at the same instance size, and that larger frontier is
// exactly what pushed the very first version of this rig into an
// out-of-memory crash partway through blocksworld's sweep.
import { solvePlannerInstance } from "./planner-domains.mjs";

const [domainName, sizeArg] = process.argv.slice(2);
const result = await solvePlannerInstance(domainName, Number(sizeArg));
process.stdout.write(JSON.stringify(result));
