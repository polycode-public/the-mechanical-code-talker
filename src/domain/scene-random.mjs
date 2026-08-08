// scene-random.mjs — the "random scene" button's vocabulary and sentence
// builder. Every word the generator can pick traces to a real source: class
// names and material/colour labels from the sprite catalog's own class index
// (itself read off data/sprites*/  templates), emotion words from the sprite
// facts' mgx:accept-emotion rows, room names from an adventure world's own
// rdf:type room facts. Nothing here holds a word list of its own.
//
// Randomness is passed in as `rng` (a () => [0,1) function — the browser
// page hands Math.random over), so everything in this module stays a pure
// function of its arguments.

const EMOTION_ACCEPT_PREDICATE = "mgx:accept-emotion";
const FACING_LABELS = Object.freeze(["left", "half-left", "half-right", "right"]);

/** The room classes a world's fact rows declare (`<subject> rdf:type room`),
 *  sorted. Pure. */
export function roomClassesFromWorldFacts(factRows) {
  const rooms = new Set();
  for (const row of factRows || []) {
    if (row?.predicate === "rdf:type" && row.object === "room" && row.subject) rooms.add(String(row.subject));
  }
  return [...rooms].sort();
}

/** True when `name` is exactly the words a typed sentence would tokenize it
 *  back into — a hyphenated class ("drawing-room") fails, so the generator
 *  never writes a name the scene parser cannot read back. Pure. */
export function isSpeakableClassName(name) {
  return /^[a-z]+( [a-z]+)*$/.test(String(name ?? ""));
}

/** The generator's whole vocabulary, derived and nothing else:
 *  - `rooms`: `roomClasses` the class index can actually draw, speakably named;
 *  - `emotions`: every value the sprite facts' mgx:accept-emotion rows carry;
 *  - `classes`: one row per drawable, speakable, non-room class — its plain
 *    material/colour labels (facing, pose, emotion and combined labels
 *    excluded), which emotions it wears, and whether it has a moving frame.
 *  Deterministic for identical inputs: every list is sorted. Pure. */
export function sceneVocabulary({ classIndex = {}, spriteFactRows = [], roomClasses = [] } = {}) {
  const emotions = new Set();
  for (const row of spriteFactRows || []) {
    if (row?.predicate === EMOTION_ACCEPT_PREDICATE && row.object) emotions.add(String(row.object));
  }
  const emotionList = [...emotions].sort();
  const rooms = (roomClasses || [])
    .filter((name) => isSpeakableClassName(name) && Object.prototype.hasOwnProperty.call(classIndex, name))
    .sort();
  const roomSet = new Set(rooms);

  const classes = [];
  for (const name of Object.keys(classIndex).sort()) {
    if (!isSpeakableClassName(name) || roomSet.has(name)) continue;
    const labels = Object.keys(classIndex[name]?.materials || {});
    const materials = labels
      .filter((l) => !l.includes("+") && !FACING_LABELS.includes(l) && l !== "moving" && !emotions.has(l))
      .sort();
    const wears = labels.filter((l) => emotions.has(l)).sort();
    classes.push({
      name,
      materials,
      emotions: wears,
      moving: labels.includes("moving"),
    });
  }
  return { rooms, emotions: emotionList, classes };
}

/** One random scene sentence over `vocab`, in the shape the scene parser
 *  reads back: a material-coloured thing on a second thing, an emotive
 *  role wearing a real emotion, a moving entity, and a room — each part
 *  present only when the vocabulary really carries it. `rng` is the one
 *  source of chance; identical rng streams give identical sentences. Pure. */
export function randomSceneSentence(vocab, rng) {
  const pick = (list) => {
    if (!list || !list.length) return null;
    const at = Math.floor(rng() * list.length);
    return list[Math.min(Math.max(at, 0), list.length - 1)];
  };
  const classes = vocab?.classes || [];
  const things = classes.filter((c) => !c.emotions.length);
  const actors = classes.filter((c) => c.emotions.length);
  const movers = classes.filter((c) => c.moving);

  const parts = [];
  const thing = pick(things.length ? things : classes);
  if (thing) {
    const material = pick(thing.materials);
    const rest = pick(things.filter((c) => c !== thing));
    const lead = `a ${material ? `${material} ` : ""}${thing.name}`;
    parts.push(rest ? `${lead} on a ${rest.name}` : lead);
  }
  const actor = pick(actors);
  if (actor) parts.push(`a ${pick(actor.emotions)} ${actor.name}`);
  const mover = pick(movers.filter((c) => c !== actor));
  if (mover) {
    const material = pick(mover.materials);
    parts.push(`a moving ${material ? `${material} ` : ""}${mover.name}`);
  }
  const room = pick(vocab?.rooms || []);
  const sentence = parts.join(" and ");
  if (!sentence) return room ? `the ${room}` : "";
  return room ? `${sentence} in the ${room}` : sentence;
}
