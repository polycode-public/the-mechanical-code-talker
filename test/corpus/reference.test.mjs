// Reference lane: the learn-on-miss flow over the REAL shipped pack
// (corpus/reference/). Positive rows pin only the citation frame, never
// article prose, so a pack refresh cannot rot them; the first row is the
// no-pack-I/O negative the fast tier samples.
import { runLane } from "./run-lane.mjs";

runLane("reference");
