// The bench-smoke lane: each benchmark rig's runner path executes its
// smallest real slice end-to-end and must yield a gradeable result shape.
// No judge calls, no network, no LLM — quality lives in the other lanes;
// this lane's signal is that a rig is runnable, so its next full run yields
// a value instead of failing mid-rig.
import { runLane } from "./run-lane.mjs";

runLane("bench-smoke");
