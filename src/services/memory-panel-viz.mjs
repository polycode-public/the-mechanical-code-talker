// memory-panel-viz.mjs — the docked "this session's memory" panel shared by
// chat.html and ingest.html: both pages seed from the same chat-seed.json
// bands and want the identical band-count/taught-list/forget-everything
// chrome, so the rendering lives once here instead of twice.
//
// Every export below is pure and `.toString()`-splice safe (no references
// outside its own parameters), the same discipline chat-page-viz.mjs's own
// provenanceChipFor/loadProgressLine hold — a page's inline script splices
// these in as text, so a closure over this module's top-level scope would
// silently vanish at splice time. Collaborators a caller may want to vary
// (the band-label lookup, a forget hook) are passed in as parameters, not
// imported, mirroring provenanceChipFor's own injected `bucketFor`.

/** The human label for one memoryStats() band key — the same band names
 *  build-chat-seed.mjs/extensions.mjs seed under, plus the two synthetic
 *  buckets memoryStats mints for anything outside a seed band
 *  ("taught this session", "other"). An unrecognized key renders as itself
 *  rather than disappearing, so a future band never goes unlabeled. */
export function bandLabelFor(key) {
  const BAND_LABELS = {
    human: "human persona",
    "human-medium": "human persona (medium)",
    "human-large": "human persona (large)",
    seon: "seon ontology",
    conceptnet: "ConceptNet",
    "tier2-aws": "AWS",
    "tier2-python": "Python",
    "tier2-java": "Java",
    "wordnet-xl": "WordNet",
  };
  return BAND_LABELS[key] || key;
}

/** The boot line's own memory summary — every seed band a session actually
 *  loaded, named with its real count, left to right in the fixed band order;
 *  a session with nothing seeded says so plainly instead of naming zero
 *  facts. `bandLabel` is the label lookup to use for each band key (pass
 *  bandLabelFor, or a page's own override). */
export function statsSummaryLine(stats, bandLabel) {
  const BAND_ORDER = [
    "human", "human-medium", "human-large", "seon", "conceptnet",
    "tier2-aws", "tier2-python", "tier2-java", "wordnet-xl",
    "taught this session", "other",
  ];
  if (!stats || !stats.total) return "no starter memory; starting empty";
  const parts = BAND_ORDER.filter((k) => stats.bandCounts[k]).map((k) => stats.bandCounts[k] + " " + bandLabel(k));
  return parts.length
    ? "starter memory: " + parts.join(" + ") + " (" + stats.total + " facts total)"
    : stats.total + " starter facts loaded";
}

/** Drop every asset the site's service worker has cached, and unregister the
 *  worker itself, so the next load reads the shipped files off the network.
 *  A page's own taught-facts store lives in IndexedDB, a different store
 *  entirely — clearing that alone would still re-seed from whatever copy of
 *  chat-seed.json the worker cached, which is the whole reason this exists.
 *  Best-effort throughout: a browser with no Cache Storage, no worker, or a
 *  storage call that throws just leaves the caller to reload as before.
 *  Pure of this module's scope, so it stays `.toString()`-splice safe. */
export async function clearSiteAssetCaches() {
  try {
    if (globalThis.caches) {
      for (const key of await caches.keys()) {
        if (key.startsWith("tmct-precache-")) await caches.delete(key);
      }
    }
  } catch { /* the reload still re-reads whatever the worker will serve */ }
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch { /* an un-unregisterable worker still has an empty cache now */ }
}

/** Fetch `url` reading the body as a stream, reporting (loadedBytes,
 *  totalBytes) after every chunk — total is 0 when the response carries no
 *  Content-Length, OR when Content-Encoding is set: the stream this function
 *  reads is always the DECOMPRESSED body (the browser decompresses before
 *  handing it to a reader), but Content-Length names the compressed wire
 *  size — reporting that as "total" against decompressed "loaded" bytes
 *  makes progress read as over 100% almost immediately. Resolves to a Blob
 *  of the whole body. Falls back to a single-shot blob() read when the
 *  runtime has no streaming body reader. */
export async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const total = res.headers.get("content-encoding") ? 0 : Number(res.headers.get("content-length")) || 0;
  if (!res.body || !res.body.getReader) {
    const blob = await res.blob();
    onProgress(blob.size, total || blob.size);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    loaded += step.value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks);
}

/**
 * (Re)render the docked "this session's memory" panel into `panelEl` from a
 * memoryStats() result: a total-facts row, one row per seed band the session
 * actually holds, then the last 8 taught facts (most recent first), most
 * recently taught last shown first. Clears and rebuilds `panelEl`'s children
 * every call — cheap at this row count, and it means a stale row can never
 * survive a re-render.
 *
 *   opts.bandLabel     required — the band-key -> label lookup (bandLabelFor,
 *                      or a page's own override).
 *   opts.taughtHint    the empty-state copy under "taught this session" when
 *                      nothing has been taught yet. Defaults to the plain
 *                      teach-a-fact prompt every page can show verbatim.
 *   opts.onForget      when set, renders a "forget everything" button wired
 *                      to this callback; omitted, no button renders (a page
 *                      with no persistence to forget).
 *   opts.persistNote   when set (and onForget is set), a short note under the
 *                      forget button naming where the state lives.
 */
export function renderStatsPanelInto(panelEl, stats, opts) {
  const { bandLabel, taughtHint, onForget = null, persistNote = null } = opts;
  const BAND_ORDER = [
    "human", "human-medium", "human-large", "seon", "conceptnet",
    "tier2-aws", "tier2-python", "tier2-java", "wordnet-xl",
    "taught this session", "other",
  ];
  function bandRow(label, count) {
    const row = document.createElement("p");
    row.className = "band-row";
    const l = document.createElement("span");
    l.textContent = label;
    const c = document.createElement("span");
    c.className = "band-count";
    c.textContent = String(count);
    row.appendChild(l);
    row.appendChild(c);
    return row;
  }

  panelEl.textContent = "";
  panelEl.appendChild(Object.assign(document.createElement("h2"), { textContent: "this session's memory" }));
  panelEl.appendChild(bandRow("total facts", stats.total));
  for (const key of BAND_ORDER) {
    if (stats.bandCounts[key]) panelEl.appendChild(bandRow(bandLabel(key), stats.bandCounts[key]));
  }

  panelEl.appendChild(Object.assign(document.createElement("h2"), { textContent: "taught this session" }));
  if (!stats.taught.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = taughtHint || 'nothing yet — teach it something ("a dog is a kind of animal") and it lands here, with its source.';
    panelEl.appendChild(empty);
  } else {
    for (const fact of stats.taught.slice(-8).reverse()) {
      const item = document.createElement("p");
      item.className = "taught-item";
      item.appendChild(document.createTextNode(fact.subject + " " + fact.predicate + " " + fact.object));
      const tag = document.createElement("span");
      tag.className = "taught-tag";
      tag.textContent = fact.tag;
      item.appendChild(tag);
      panelEl.appendChild(item);
    }
  }

  if (onForget) {
    const forget = document.createElement("button");
    forget.type = "button";
    forget.id = "forgetEverything";
    forget.className = "forget-btn";
    forget.textContent = "forget everything";
    forget.title = "clear what this device has saved and restart from the fresh seed";
    forget.addEventListener("click", onForget);
    panelEl.appendChild(forget);
    if (persistNote) {
      const note = document.createElement("p");
      note.className = "persist-note";
      note.textContent = persistNote;
      panelEl.appendChild(note);
    }
  }
}

/** The boot statusline while the big engine assets stream in — byte-identical
 *  across research-viz.mjs and ingest-viz.mjs, each commenting that it uses
 *  "the same aggregator" as the other. `parts` is an array of { loaded, total }
 *  byte counts (total 0 when a response carried no Content-Length); with no
 *  usable total the line shows loaded bytes alone rather than inventing a
 *  denominator. Self-contained, `.toString()`-splice safe. */
export function loadProgressLine(parts) {
  const mb = (n) => (n / 1048576).toFixed(1);
  let loaded = 0;
  let total = 0;
  let totalKnown = true;
  for (const p of parts || []) {
    loaded += (p && p.loaded) || 0;
    if (p && p.total > 0) total += p.total;
    else totalKnown = false;
  }
  return totalKnown && total > 0
    ? "loading the engine… " + mb(loaded) + " MB / " + mb(total) + " MB"
    : "loading the engine… " + mb(loaded) + " MB";
}

/** One learned/grounded fact as its three canonical cells, plus whichever of
 *  the two per-page provenance fields the caller's fact objects carry: `source`
 *  (research.html's source key, e.g. "taught"/"seed:conceptnet" — used for the
 *  tone dot) and `provenance` (ingest.html's raw ' | '-joined tag string —
 *  shown verbatim). Both default to "" when the fact object doesn't carry
 *  that field, so either page reads back only the one it populated. Pure,
 *  `.toString()`-splice safe. */
export function factTripleParts(fact) {
  return {
    subject: String((fact && fact.subject) || ""),
    predicate: String((fact && fact.predicate) || ""),
    object: String((fact && fact.object) || ""),
    source: String((fact && fact.source) || ""),
    provenance: String((fact && fact.provenance) || ""),
  };
}
