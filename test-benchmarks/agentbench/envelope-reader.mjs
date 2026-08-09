// The runtime-readable AGENTBENCH capability envelope: package.json's
// "./envelope" export subpath resolves here, so a downstream calibration reads
// tmct's measured capability at runtime instead of hand-copying a snapshot of
// it into its own source (see generate-envelope.mjs for what the fields mean
// and how envelope.json is produced). The import below targets the sibling
// file directly, so there is no separate copy that could drift from it.
import envelope from "./envelope.json" with { type: "json" };

/** The AGENTBENCH capability envelope, freshly cloned so a caller mutating its
 *  result can't corrupt what the next caller sees. */
export function agentbenchEnvelope() {
  return structuredClone(envelope);
}
