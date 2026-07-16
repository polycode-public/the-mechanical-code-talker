// The pure key both session artifacts agree on: the transcript parser writes it
// and the fold's cleaner reads it, so it lives where each can legally import it.

/** Key a transcript answer by its turn: ts + query (ts alone can collide when
 *  two instant turns land in the same millisecond). The separator is NUL so it
 *  cannot occur in either half. */
export const turnKey = (ts, query) => `${ts}\0${query}`;
