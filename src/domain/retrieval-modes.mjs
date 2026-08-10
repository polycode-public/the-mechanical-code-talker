// retrieval-modes.mjs — the two honest modes a turn's retrieval payload can
// carry. Every layer that needs to say "the corpus supplement ran" or "it
// did not" reads these two strings rather than minting its own, so a
// retrieval-layer skip and a breaker-forced skip land in an answer looking
// identical.

/** Retrieval ran and the answer stands on the corpus supplement as well as
 *  the seed and the session. */
export const SUPPLEMENTED_MODE = "supplemented";

/** No corpus read happened — no bands are configured, or the breaker is
 *  open. The answer stands on the bundled seed and the session alone. */
export const SEED_SESSION_MODE = "seed-session";
