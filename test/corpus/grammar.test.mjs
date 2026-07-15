// The grammar corpus lane: every parsable sentence structure → its expected
// resolution at the chat surface. Rows live in grammar.jsonl.
import { runLane } from "./run-lane.mjs";

runLane("grammar");
