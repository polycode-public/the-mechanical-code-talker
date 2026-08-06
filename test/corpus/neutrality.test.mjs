// The neutrality corpus lane: the bare-install probes (banner/greeting,
// counts, code-shaped questions, help, orientation, /stats) paired with the
// active-pack probes over the same turns, pinning both today's active-domain
// strings and the neutral wording a session with no code domain active
// renders instead. Rows live in neutrality.jsonl.
import { runLane } from "./run-lane.mjs";

runLane("neutrality");
