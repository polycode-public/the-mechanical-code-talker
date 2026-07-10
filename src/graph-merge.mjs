// graph-merge.mjs — multi-graph payload merging (the CLI/config unification
// batch's multi-graph support). Used ONLY by source.mjs's fetchEntities when a
// config carries more than one graph file (`config.graphFiles.length > 1`);
// the single-graph path never calls this — that byte-identical guarantee
// lives in source.mjs, not here.
//
// Individual ids are NOT collision-safe across repos — codegraph.mjs builds
// ids as `mod:${relativePath}` (repo-relative), so two graphs describing
// similarly-structured repos can collide. mergeEntityPayloads concatenates the
// straightforward arrays (classes/vocabulary/objectProperties/individuals),
// unions proseIndex (merging the id-array per word key), and — Option A, only
// on an ACTUAL collision — prefixes the specific colliding ids (and every
// in-payload reference to them: derived_from entries, mentions, edge subject/
// object, proseIndex entries) with `<graphName>/`. Ids that never collide pass
// through untouched, so the common (no-collision) case stays fully readable.

/** Every individual id a payload declares, as a Set (cheap membership tests). */
function idsOf(payload) {
  const s = new Set();
  for (const ind of Array.isArray(payload?.individuals) ? payload.individuals : []) {
    if (ind && ind.id) s.add(ind.id);
  }
  return s;
}

/**
 * Merge N single-graph entities payloads into one.
 *
 * @param {Array<{file?: string, payload: object, name?: string}>} entries
 *   one entry per graph file already read+parsed; `name` is an explicit
 *   tmct.toml `[[graphs]]` name, defaulting to the entry's array index
 *   (stringified) when absent.
 * @returns {object} a payload of the exact shape parseEntities/fetchEntities
 *   already produce for a single graph: {generated_at, classes, vocabulary,
 *   objectProperties, individuals, proseIndex, bootstrap?}.
 */
export function mergeEntityPayloads(entries) {
  const list = (Array.isArray(entries) ? entries : []).map((e, i) => ({
    file: e?.file,
    payload: e?.payload || {},
    name: e?.name != null && String(e.name).length ? String(e.name) : String(i),
  }));

  // Set-based collision detection, O(n): an id "collides" when it appears in
  // more than one payload's own individuals list.
  const idSets = list.map(({ payload }) => idsOf(payload));
  const seenInCount = new Map();
  for (const s of idSets) for (const id of s) seenInCount.set(id, (seenInCount.get(id) || 0) + 1);
  const colliding = new Set([...seenInCount.entries()].filter(([, n]) => n > 1).map(([id]) => id));

  const merged = {
    generated_at: "",
    classes: [],
    vocabulary: [],
    objectProperties: [],
    individuals: [],
    proseIndex: {},
  };
  let latestGeneratedAt = "";
  let everyPayloadIsBootstrap = list.length > 0;

  for (const { payload, name } of list) {
    everyPayloadIsBootstrap = everyPayloadIsBootstrap && Boolean(payload.bootstrap);
    if (typeof payload.generated_at === "string" && payload.generated_at > latestGeneratedAt) {
      latestGeneratedAt = payload.generated_at;
    }

    const rewriteId = (id) => (colliding.has(id) ? `${name}/${id}` : id);

    if (Array.isArray(payload.classes)) merged.classes.push(...payload.classes);
    if (Array.isArray(payload.vocabulary)) merged.vocabulary.push(...payload.vocabulary);

    for (const ind of Array.isArray(payload.individuals) ? payload.individuals : []) {
      if (!ind) continue;
      const out = { ...ind };
      if (out.id) out.id = rewriteId(out.id);
      if (Array.isArray(out.derived_from)) {
        out.derived_from = out.derived_from.map((r) => rewriteId(r));
      }
      if (Array.isArray(out.mentions)) {
        out.mentions = out.mentions.map((m) => (m && m.id ? { ...m, id: rewriteId(m.id) } : m));
      }
      merged.individuals.push(out);
    }

    for (const grp of Array.isArray(payload.objectProperties) ? payload.objectProperties : []) {
      if (!grp) continue;
      const out = { ...grp };
      if (Array.isArray(out.examples)) {
        out.examples = out.examples.map((e) => {
          if (!e) return e;
          const ne = { ...e };
          if (ne.subject) ne.subject = rewriteId(ne.subject);
          if (ne.object) ne.object = rewriteId(ne.object);
          return ne;
        });
      }
      merged.objectProperties.push(out);
    }

    const proseIndex = payload.proseIndex && typeof payload.proseIndex === "object" ? payload.proseIndex : {};
    for (const [word, ids] of Object.entries(proseIndex)) {
      const bucket = merged.proseIndex[word] || (merged.proseIndex[word] = []);
      for (const id of Array.isArray(ids) ? ids : []) {
        const rewritten = rewriteId(id);
        if (!bucket.includes(rewritten)) bucket.push(rewritten);
      }
    }
  }

  merged.generated_at = latestGeneratedAt;
  if (everyPayloadIsBootstrap) merged.bootstrap = true;
  return merged;
}
