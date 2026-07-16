// The planning corpus lane: taught state + goal → the expected plan, its
// step-by-step execution, and the /plan capability route. Rows live in
// planning.jsonl.
import { runLane } from "./run-lane.mjs";

runLane("planning");
