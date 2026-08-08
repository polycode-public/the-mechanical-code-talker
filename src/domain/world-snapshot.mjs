// domain/world-snapshot.mjs — the one grammar for a snapshot subject: bare
// `base@turnN` while a world stays on epoch 0, `base@epochE@turnN` once a
// recast has moved it on. Pure, no imports — every reader of this grammar
// (the adventure lane, autoplay, the recognizer) reads it from here instead
// of keeping its own copy.

const SNAPSHOT_RE = /^(.+?)@(?:epoch(\d+)@)?turn(\d+)$/;

/** The snapshot subject a turn writes: bare `base@turnN` while the world is
 *  on epoch 0, `base@epochE@turnN` once a recast has moved it on. */
export function snapshotSubject(base, turn, epoch = 0) {
  return epoch > 0 ? `${base}@epoch${epoch}@turn${turn}` : `${base}@turn${turn}`;
}

/** Read a snapshot subject back: `{ base, epoch, turn }`, or null when the
 *  subject carries no snapshot stamp (a base row). Pure. */
export function parseSnapshotSubject(subject) {
  const m = SNAPSHOT_RE.exec(String(subject || ""));
  return m ? { base: m[1], epoch: m[2] ? Number(m[2]) : 0, turn: Number(m[3]) } : null;
}

/** The base individual a subject names, snapshot-stamped or not. */
export function baseSubjectOf(subject) {
  return parseSnapshotSubject(subject)?.base ?? subject;
}
