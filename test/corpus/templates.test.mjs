// The templates lane: sentence in, template-shaped answer out. Every row
// drives a real createSession and pins the rendered wording — exactly for
// the deterministic surfaces (greetings, declines, orientation, counts),
// by pattern where a provenance stamp or timestamp varies per run.
import { runLane } from "./run-lane.mjs";

runLane("templates");
