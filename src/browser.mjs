// browser.mjs — Chronograph, the temporal code browser (PLAN_CODE_BROWSER.md), on
// the unified viewer architecture: ONE generated page, data loaded at runtime, the
// same page served by the website and by `seonix viz --serve` against a local index.
//
// Node-side: buildTemporalGraph (graph.json + git-log order → validity intervals),
// buildBrowserData (the runtime payload), renderBrowserHtml (the page). The page's
// scrub/diff/narration/query/URL logic is NOT duplicated here — renderBrowserHtml
// inlines the SOURCE of ../src/temporal.mjs (exports stripped), so the browser runs
// the exact functions `node --test` verifies. chronograph/build.mjs (legacy P0) is a
// thin wrapper over the same builder.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deriveNodeInterval, deriveEdgeInterval, repoOfId, assignRepo, isMultiRepo } from "./temporal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const execFileP = promisify(execFile);

// Structural edge kinds kept in the temporal graph (module-coarse "touches" drops
// as a duplicate of symbol-level touchesSymbol history).
const STRUCT_KINDS = new Set([
  "defines", "callsSymbol", "calls", "imports",
  "reexports", "inherits", "contains", "cochange", "tests",
]);

// Default scope: hand-written product code, minus corpus/build/vendor noise.
const PRODUCT_EXCLUDE = [
  "corpus/", "node_modules/", "vendor/", ".venv/",
  "infra/", "archive/", ".seonix/",
];

// SEON/mgx prop token -> edge kind (mirrors codegraph.mjs's vocabulary).
const PROP_KIND = {
  "mgx:importsnamespace": "imports",
  "mgx:callscoarse": "calls",
  "seon:declaresmethod": "defines",
  "mgx:testscoverage": "tests",
  "mgx:touchedbycommit": "touches",
  "seon:containscodeentity": "contains",
  "seon:hassupertype": "inherits",
  "mgx:changecoupledwith": "cochange",
  "mgx:reexports": "reexports",
  "mgx:touchessymbol": "touchesSymbol",
  "mgx:callssymbol": "callsSymbol",
};

const pathOfId = (id) => {
  const m = String(id).match(/^[a-z]+:([^#]+)/);
  return m ? m[1] : null;
};

function makeScopeFilter(scopeArg) {
  if (!scopeArg || scopeArg === "product") {
    return (id) => {
      const p = pathOfId(id);
      if (!p) return false;
      if (p.includes("cdk.out")) return false;
      return !PRODUCT_EXCLUDE.some((x) => p.startsWith(x));
    };
  }
  const prefixes = scopeArg.split(",").map((s) => s.trim()).filter(Boolean);
  return (id) => {
    const p = pathOfId(id);
    return p != null && prefixes.some((pre) => p.startsWith(pre));
  };
}

function kindOf(group) {
  const prop = String(group?.prop || "").toLowerCase();
  if (PROP_KIND[prop]) return PROP_KIND[prop];
  return String(group?.predicate || "") || null;
}

const attr = (ind, key) => {
  const a = (ind?.attributes || []).find((x) => x.key === key);
  return a ? String(a.value) : "";
};

/**
 * Ordered (oldest → newest) shas for the graph's Commit individuals via git log.
 *
 * A MERGED multi-repo graph (extract.mjs indexRepositories) has no single git repo to
 * shell — `repo` is the common-ancestor out_root, which is usually not itself a git
 * checkout — so `git log` there returns nothing that matches. In that case, if the
 * caller supplies `datesBySha` (commit sha → ISO commit date), fall back to a global
 * chronological order across all repos. Single-repo callers pass no dates and keep the
 * existing git path unchanged. (buildTemporalGraph independently re-derives the
 * date-order when it detects a merge, so a viz caller that passes only cwd is still
 * correct; this fallback makes gitCommitOrder itself repo-set-agnostic and testable.)
 * @param {string} repo
 * @param {Iterable<string>} graphCommitIds
 * @param {{datesBySha?: Map<string,string>|null}} [opts]
 */
export async function gitCommitOrder(repo, graphCommitIds, { datesBySha = null } = {}) {
  const shas = new Set([...graphCommitIds].map((id) => String(id).replace(/^commit:/, "")));
  let ordered = [];
  try {
    const { stdout } = await execFileP("git", ["-C", repo, "log", "--format=%H"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    ordered = stdout.trim().split("\n").reverse().filter((s) => shas.has(s));
  } catch {
    /* fall through to graph/date order */
  }
  if (!ordered.length && datesBySha) {
    // Merged-graph fallback: one commit date axis across every repo (tie-break by sha
    // so equal timestamps stay deterministic).
    ordered = [...shas].sort((a, b) => {
      const da = datesBySha.get(a) || "";
      const db = datesBySha.get(b) || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  if (!ordered.length) ordered = [...shas];
  return ordered;
}

/**
 * Parent shas of every commit reachable from HEAD (P3 ghost-branch merges —
 * PLAN_CODE_BROWSER.md "follow-one-branch, ghost merges"). A commit with ≥2
 * parents is a merge; parents beyond the first are the tip of whatever branch
 * got folded in. Best-effort: an empty Map on any git failure, so callers
 * degrade to "no merge info" the same way a HEAD-only index already degrades.
 * @param {string} repo
 * @returns {Promise<Map<string, string[]>>} sha -> parent shas, git's own order
 *   (a root commit maps to []).
 */
export async function gitCommitParents(repo) {
  const parents = new Map();
  try {
    const { stdout } = await execFileP("git", ["-C", repo, "log", "--format=%H %P"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const [sha, ...ps] = line.split(" ").filter(Boolean);
      if (sha) parents.set(sha, ps);
    }
  } catch {
    /* empty map — merge info is best-effort, never fatal */
  }
  return parents;
}

/**
 * RAW graph.json (+ an oldest-first sha order) → the temporal graph the browser
 * scrubs. Pure given its inputs; the one source for chronograph/build.mjs, the
 * website artifact, and `viz --serve`'s live payload.
 * @param {object} raw          parsed .seonix/graph.json
 * @param {string[]} orderShas  oldest-first commit shas (see gitCommitOrder)
 * @param {{scope?: string, parentsBySha?: Map<string,string[]>}} [opts]
 */
export function buildTemporalGraph(raw, orderShas, { scope = "product", parentsBySha = new Map() } = {}) {
  const individuals = Array.isArray(raw.individuals) ? raw.individuals : [];
  const groups = Array.isArray(raw.objectProperties) ? raw.objectProperties : [];
  const inScope = makeScopeFilter(scope);

  const commitInds = individuals.filter((i) => i.class === "Commit");
  const commitById = new Map(commitInds.map((c) => [c.id, c]));

  // P4 cross-repo: a commit's repo is inferred from the id-prefixes of the modules it
  // touches (touchesSymbol edges) — commits themselves are unprefixed (one per sha).
  // This is order-independent, so we can detect a merge BEFORE choosing the time axis.
  const prefixByCommit = new Map(); // commit id -> Map<repoPrefix, touch count>
  for (const g of groups) {
    if (kindOf(g) !== "touchesSymbol") continue;
    for (const e of g.examples || []) {
      const prefix = repoOfId(e.object);
      if (!prefix || !commitById.has(e.subject)) continue;
      let m = prefixByCommit.get(e.subject);
      if (!m) { m = new Map(); prefixByCommit.set(e.subject, m); }
      m.set(prefix, (m.get(prefix) || 0) + 1);
    }
  }
  const multi = isMultiRepo(commitInds.map((c) => prefixByCommit.get(c.id) || new Map()));
  const repoOfCommitId = (id) => (multi ? assignRepo(prefixByCommit.get(id) || new Map()) : null);

  // Single-repo: git-log order (or the given order) exactly as before. Merged graph:
  // there is no single repo to shell, so order by the stored commit date across ALL
  // repos — one global time axis, tie-broken by sha for determinism.
  const order = multi
    ? [...commitInds]
        .sort((a, b) => {
          const da = attr(a, "date");
          const db = attr(b, "date");
          if (da < db) return -1;
          if (da > db) return 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        })
        .map((c) => String(c.id).replace(/^commit:/, ""))
    : (orderShas && orderShas.length)
      ? orderShas
      : commitInds.map((c) => String(c.id).replace(/^commit:/, ""));
  const ordinalOf = new Map(order.map((sha, i) => [`commit:${sha}`, i]));
  const headIdx = Math.max(0, order.length - 1);
  const commits = order.map((sha, i) => {
    const c = commitById.get(`commit:${sha}`);
    // P3 ghost-branch merges: parents present in `order` become jump-able
    // ordinals; parents NOT present (their commits never touched a tracked
    // symbol) are a "ghost" tributary — counted, not dropped, so a merge
    // still reads as a merge even when its side-branch is otherwise invisible.
    const parentIdx = [];
    let ghostParents = 0;
    for (const p of (parentsBySha.get(sha) || [])) {
      const pi = ordinalOf.get(`commit:${p}`);
      if (pi != null) parentIdx.push(pi);
      else ghostParents += 1;
    }
    const commit = {
      idx: i,
      sha,
      shortSha: sha.slice(0, 12),
      date: c ? attr(c, "date") : "",
      author: c ? attr(c, "author") : "",
      subject: c ? attr(c, "message") : "",
      parentIdx,
      ghostParents,
      merge: parentIdx.length + ghostParents > 1,
    };
    // P4: tag with the owning repo ONLY on a merged graph (single-repo stays identical).
    if (multi) {
      const r = repoOfCommitId(`commit:${sha}`);
      if (r) commit.repo = r;
    }
    return commit;
  });

  const symInds = individuals.filter((i) => i.class !== "Commit" && inScope(i.id));
  const nodeIds = new Set(symInds.map((i) => i.id));

  const touchesByNode = new Map();
  const tsEdges = [];
  for (const g of groups) {
    if (kindOf(g) !== "touchesSymbol") continue;
    for (const e of g.examples || []) {
      const ord = ordinalOf.get(e.subject);
      if (ord == null || !nodeIds.has(e.object)) continue;
      if (!touchesByNode.has(e.object)) touchesByNode.set(e.object, new Set());
      touchesByNode.get(e.object).add(ord);
      tsEdges.push({ src: e.subject, dst: e.object, ord });
    }
  }

  // Container chain (defines/contains) gives history-less symbols a birth fallback.
  const parentOf = new Map();
  for (const g of groups) {
    const k = kindOf(g);
    if (k !== "defines" && k !== "contains") continue;
    for (const e of g.examples || []) {
      if (nodeIds.has(e.subject) && nodeIds.has(e.object) && !parentOf.has(e.object)) {
        parentOf.set(e.object, e.subject);
      }
    }
  }
  // Roll symbol history UP the container chain (P2): a module is touched when any
  // of its symbols is. touchesSymbol edges land on symbols, so without this roll-up
  // module-grain gravity, heat, and the touched:/since: query terms are blind —
  // observed on the real self-index: 109 module↔module cochange edges, 0 modules
  // with direct touches.
  for (const [id, set] of [...touchesByNode]) {
    let cur = parentOf.get(id);
    const seen = new Set([id]);
    while (cur && !seen.has(cur)) {
      if (!touchesByNode.has(cur)) touchesByNode.set(cur, new Set());
      for (const o of set) touchesByNode.get(cur).add(o);
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  const directBorn = (id) => {
    const s = touchesByNode.get(id);
    return s && s.size ? Math.min(...s) : null;
  };
  const fallbackBorn = (id) => {
    let cur = parentOf.get(id);
    const seen = new Set([id]);
    while (cur && !seen.has(cur)) {
      const b = directBorn(cur);
      if (b != null) return b;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return 0;
  };

  const bornOf = new Map();
  const nodes = [];
  for (const ind of symInds) {
    const touches = [...(touchesByNode.get(ind.id) || [])].sort((a, b) => a - b);
    const [born, died] = deriveNodeInterval(touches, headIdx, fallbackBorn(ind.id));
    bornOf.set(ind.id, born);
    const node = {
      id: ind.id,
      type: ind.class,
      label: ind.label || ind.id,
      site: attr(ind, "site"),
      born,
      died,
      touches,
      churn: touches.length,
    };
    // P4: a symbol's repo is right in its id prefix on a merged graph — carry it so the
    // browser can badge by repo without re-parsing. Guarded → single-repo unchanged.
    if (multi) { const r = repoOfId(ind.id); if (r) node.repo = r; }
    nodes.push(node);
  }
  for (const c of commits) {
    const node = {
      id: `commit:${c.sha}`, type: "Commit", label: c.shortSha, site: "",
      born: c.idx, died: headIdx, touches: [], churn: 0, commitIdx: c.idx,
    };
    if (multi && c.repo) node.repo = c.repo;
    nodes.push(node);
    bornOf.set(`commit:${c.sha}`, c.idx);
  }

  const edges = [];
  const seen = new Set();
  for (const g of groups) {
    const kind = kindOf(g);
    if (!STRUCT_KINDS.has(kind)) continue;
    for (const e of g.examples || []) {
      if (!nodeIds.has(e.subject) || !nodeIds.has(e.object)) continue;
      const key = `${e.subject}|${e.object}|${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        src: e.subject,
        dst: e.object,
        kind,
        valid: deriveEdgeInterval(bornOf.get(e.subject) ?? 0, bornOf.get(e.object) ?? 0, headIdx),
      });
    }
  }
  const seenTs = new Set();
  for (const e of tsEdges) {
    const key = `${e.src}|${e.dst}`;
    if (seenTs.has(key)) continue;
    seenTs.add(key);
    edges.push({ src: e.src, dst: e.dst, kind: "touchesSymbol", valid: [e.ord, headIdx] });
  }

  // Degree over structural edges only — the declutter filter's input.
  const degree = new Map();
  for (const e of edges) {
    if (e.kind === "touchesSymbol") continue;
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
  }
  for (const n of nodes) n.degree = degree.get(n.id) || 0;

  return {
    meta: {
      scope,
      commit_order: multi
        ? "oldest-first by commit date across all repos (merged multi-repo graph)"
        : "oldest-first (ordinal 0 = oldest, N-1 = HEAD)",
      note: "died = HEAD for every node: a HEAD-only index cannot observe deletions.",
      counts: { commits: commits.length, nodes: nodes.length, edges: edges.length, touchesSymbol_edges: tsEdges.length },
      // P4: present ONLY on a merged graph, so single-repo meta is byte-identical.
      ...(multi ? { multi_repo: true, repos: [...new Set(commits.map((c) => c.repo).filter(Boolean))].sort() } : {}),
    },
    commits,
    nodes,
    edges,
  };
}

/** The browser's runtime payload: the temporal graph + everything repo-specific.
 *  P3 live re-annotate: `live` + `gitHead` are set ONLY by `viz --serve` (never by
 *  the static site generator); the client polls `/code-browser-version` and — since
 *  the page's whole view state already round-trips through the URL (P1) — a plain
 *  reload on HEAD change is enough to pick up a re-index without losing the cursor,
 *  selection, or query. */
export function buildBrowserData(tg, { repoUrl = "", repoRef = "main", siteNav = false, live = false, gitHead = "", nav = null } = {}) {
  // `nav` ({name: href}) rebuilds the page's #sitenav; `siteNav` is the legacy
  // flag — stale deployed data keeps its absolute links.
  return { ...tg, repoUrl: String(repoUrl).replace(/\/+$/, ""), repoRef, siteNav: !!siteNav, ...(nav ? { nav } : {}), live: !!live, gitHead };
}

/** The tested temporal core, ready to inline into the page (exports stripped). */
export async function temporalSource() {
  const src = await readFile(join(here, "temporal.mjs"), "utf8");
  return src.replace(/^export /gm, "");
}

const inlineJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

/**
 * The ONE Chronograph page. Repo-agnostic like the viz viewer: data resolves from
 * `?data=` → embedded block → generated pointer → sibling ./code-browser-data.json.
 * `temporal` is the inlined source from temporalSource().
 */
export function renderBrowserPage({ cytoscape, temporal, embedData = null, dataPath = null } = {}) {
  const embedded = embedData ? `<script type="application/json" id="seonix-data">${inlineJson(embedData)}</script>\n` : "";
  const cfg = dataPath ? `<script type="application/json" id="seonix-cfg">${inlineJson({ data: dataPath })}</script>\n` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>seon chronograph</title>
<!-- generated by: seonix viz --browser-out (packages/seonix/src/browser.mjs) — one page, data at runtime;
     the scrub/diff/narration/query logic below is the inlined source of src/temporal.mjs (node-tested). -->
<style>
  html,body{margin:0;height:100%;font:13px system-ui,sans-serif;background:#1a1b26;color:#c0caf5}
  body{display:flex;flex-direction:column}
  #bar{padding:6px 12px;background:#16161e;border-bottom:1px solid #2a2e42;display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 0 auto}
  #bar .grp{display:inline-flex;gap:8px;align-items:center;padding:0 10px;border-right:1px solid #2a2e42}
  #bar .grp:first-child{padding-left:0} #bar .grp:last-of-type,#bar .nav{border-right:0}
  #bar .nav{margin-left:auto} #bar .nav a{color:#7aa2f7;text-decoration:none;font-size:12px} #bar .nav a:hover{text-decoration:underline}
  #bar label,.lbl{color:#a9b1d6} #bar b{color:#7aa2f7}
  #bar button{background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit;line-height:1.2}
  #bar button:hover{border-color:#7aa2f7;color:#7aa2f7}
  #bar button.on{background:#7aa2f7;color:#16161e;font-weight:600}
  #q{width:15em;background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;padding:2px 6px;font:inherit}
  #deg{width:3.2em;background:#1a1b26;color:#c0caf5;border:1px solid #2a2e42;border-radius:4px;padding:1px 4px;font:inherit}
  #legend{padding:4px 12px 6px;background:#16161e;border-bottom:1px solid #2a2e42;display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;flex:0 0 auto}
  .lg{white-space:nowrap;cursor:pointer;user-select:none;color:#a9b1d6}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}.lg input{vertical-align:middle;margin:0 3px 0 0}
  .lg .cnt{color:#565f89;margin-left:3px;font-size:11px;font-variant-numeric:tabular-nums}
  #difflegend{display:none;gap:12px;font-size:12px;color:#a9b1d6;align-items:center}
  #difflegend i{display:inline-block;width:10px;height:10px;border-radius:50%;border:3px solid;background:transparent;margin-right:4px;vertical-align:middle}
  #main{flex:1 1 auto;position:relative;min-height:0}
  #cy{position:absolute;top:0;left:0;right:320px;bottom:0}
  #side{position:absolute;top:0;right:0;width:320px;bottom:0;background:#16161e;border-left:1px solid #2a2e42;padding:14px;overflow:auto;box-sizing:border-box}
  #tl{flex:0 0 auto;background:#16161e;border-top:1px solid #2a2e42;padding:6px 12px 8px}
  #tlcanvas{width:100%;height:56px;display:block;cursor:crosshair}
  #tlmeta{font-size:12px;color:#a9b1d6;margin-top:4px;min-height:1.2em}
  #narr{white-space:pre-wrap;background:#1a1b26;border:1px solid #2a2e42;border-radius:6px;padding:10px;font-size:12px;line-height:1.55;color:#c0caf5;margin:0 0 12px}
  #narr b{color:#7aa2f7}
  #qnote{display:none;color:#e0af68;font-size:12px;margin:0 0 8px}
  #side h3{margin:2px 0 8px;color:#c0caf5;font-size:15px;word-break:break-all}
  #side h4{margin:12px 0 4px;color:#a9b1d6;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  #side ul{margin:4px 0;padding-left:18px;font-size:12px} #side li{margin:2px 0}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border:1px solid #2a2e42;border-radius:10px;font-size:11px;color:#a9b1d6}
  .badge i{width:8px;height:8px;border-radius:50%;display:inline-block}
  .btn{display:inline-block;padding:4px 10px;border:1px solid #3b4261;border-radius:5px;color:#7aa2f7;background:#1a1b26;cursor:pointer;text-decoration:none;font:inherit;font-size:12px}
  .btn:hover{border-color:#7aa2f7}
  .row{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}
  .hint{color:#565f89;font-size:11px;margin-top:10px}
  .empty{color:#a9b1d6;font-size:12px;line-height:1.7}
  code{color:#9aa5ce;word-break:break-all}
  dialog{background:#16161e;color:#c0caf5;border:1px solid #2a2e42;border-radius:8px;padding:16px 20px;max-width:26em}
  dialog::backdrop{background:rgba(0,0,0,.5)}
  dialog h2{margin:0 0 10px;font-size:14px;color:#7aa2f7}
  dialog table{border-collapse:collapse;font-size:12px}
  dialog td{padding:2px 10px 2px 0;vertical-align:top}
  kbd{background:#1a1b26;border:1px solid #3b4261;border-radius:3px;padding:0 5px;font:inherit;color:#c0caf5}
  dialog .row{margin-top:12px}
</style></head><body>
<div id="bar">
  <span class="grp"><b>seon</b> chronograph <span class="lbl" id="scopelabel"></span></span>
  <span class="grp"><input id="q" type="search" placeholder="query — e.g. type:Class render" title="whitespace-ANDed terms: type:Class · touched:>N · since:<sha> · cochange:<name> · free words substring-match name/path"></span>
  <span class="grp"><button id="cmp" title="two-cursor structural diff: pin A, move B">compare</button>
    <span id="abpick" style="display:none"><button id="pickA" class="on" title="clicks move cursor A">A</button><button id="pickB" title="clicks move cursor B">B</button></span></span>
  <span class="grp"><button id="grav" title="co-change gravity: symbols that historically change together pull into clusters; the layout re-runs when the cursor settles">gravity</button><button id="heat" title="hotspot heat: recency-weighted churn as a warm halo (paused in compare mode — the diff owns attention)">heat</button></span>
  <span class="grp"><button id="play">▶ play</button></span>
  <span class="grp"><label title="hide symbols with fewer structural edges than this">declutter deg≥ <input id="deg" type="number" min="0" max="99" value="2"></label></span>
  <span class="grp"><button id="reset" title="fit (Esc)">fit</button><button id="zoomout">−</button><button id="zoomin">+</button><button id="help" title="keyboard shortcuts (?)" aria-haspopup="dialog">?</button></span>
  <span class="grp nav" id="sitenav" hidden><a href="/">home</a><a href="/seonix-graph.html">graph</a><a href="/timeline.html">timeline</a></span>
</div>
<div id="legend"></div>
<div id="legend2" style="padding:0 12px 6px;background:#16161e;border-bottom:1px solid #2a2e42"><span id="difflegend"><i style="border-color:#4fd67a"></i>added <i style="border-color:#e0af68"></i>changed/rewired <i style="border-color:#f7768e"></i>removed</span></div>
<div id="main">
  <div id="cy" tabindex="0" aria-label="code graph — press Enter to select the highest-degree visible symbol, ? for the full key map"></div>
  <div id="side"><p id="qnote"></p><pre id="narr"></pre><div id="detail" tabindex="-1"></div></div>
</div>
<div id="tl"><canvas id="tlcanvas"></canvas><div id="tlmeta"></div></div>
<dialog id="helpdlg" aria-label="keyboard shortcuts">
  <h2>keyboard shortcuts</h2>
  <table>
    <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>move the cursor (active cursor in compare mode)</td></tr>
    <tr><td><kbd>space</kbd></td><td>play / pause the scrub</td></tr>
    <tr><td><kbd>Enter</kbd></td><td>select a node (highest-degree visible, if none selected) and open its biography</td></tr>
    <tr><td><kbd>]</kbd></td><td>jump to the next outgoing neighbour of the selected node</td></tr>
    <tr><td><kbd>[</kbd></td><td>jump to the next incoming neighbour of the selected node</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>close this dialog, else clear selection and fit</td></tr>
    <tr><td><kbd>?</kbd></td><td>toggle this dialog</td></tr>
  </table>
  <p class="row"><button class="btn" id="helpclose">close</button></p>
</dialog>
${embedded}${cfg}<script>${cytoscape}</script>
<script>
// ---- inlined node-tested temporal core (src/temporal.mjs, exports stripped) ----
${temporal}
// ---- page ----------------------------------------------------------------------
const COLORS={Module:'#3987e5',Class:'#c98500',Function:'#008300',Method:'#d55181',Attribute:'#9085e9',GlobalVariable:'#d95926',Commit:'#199e70'};
const TYPES=Object.keys(COLORS);
const DEFAULT_OFF=new Set(['Commit']); // history stays a panel fact by default, not canvas noise
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
async function loadData(){
  const q=new URLSearchParams(location.search).get('data');
  if(!q){const emb=document.getElementById('seonix-data');if(emb)return JSON.parse(emb.textContent);}
  const cfgEl=document.getElementById('seonix-cfg');
  const url=q||(cfgEl?JSON.parse(cfgEl.textContent).data:'./code-browser-data.json');
  const r=await fetch(url);
  if(!r.ok)throw new Error('HTTP '+r.status+' loading '+url);
  return r.json();
}
const S={tg:null,byId:new Map(),cursor:0,head:0,cursorB:null,active:'a',enabled:new Set(TYPES.filter(t=>!DEFAULT_OFF.has(t))),minDeg:2,q:'',qSet:null,sel:null,playing:false,cy:null,grav:false,heat:false};
function init(tg){
  S.tg=tg;S.head=Math.max(0,tg.commits.length-1);S.cursor=S.head;
  for(const n of tg.nodes)S.byId.set(n.id,n);
  document.title='seon chronograph — '+(tg.meta&&tg.meta.scope||'');
  $('scopelabel').textContent=(tg.meta&&tg.meta.scope?'· '+tg.meta.scope:'')+' · '+tg.commits.length+' commits · '+tg.nodes.length+' nodes'+(tg.live?' · live':'');
  if(tg.nav){$('sitenav').innerHTML=Object.entries(tg.nav).map(([k,h])=>'<a href="'+esc(h)+'">'+esc(k)+'</a>').join('');$('sitenav').hidden=false;}
  else if(tg.siteNav)$('sitenav').hidden=false;
  // ---- URL state in (query-as-URL: the whole view is the link) ----
  const st=decodeViewState(location.search);
  if(st.q){S.q=st.q;$('q').value=st.q;S.qSet=matchQuery(tg,st.q);}
  const at=resolveCursor(tg,st.at);if(at!=null)S.cursor=at;
  const b=resolveCursor(tg,st.b);if(b!=null)S.cursorB=b;
  if(st.types){S.enabled=new Set(st.types.split(',').filter(t=>TYPES.includes(t)));}
  S.minDeg=st.deg;$('deg').value=st.deg;
  if(st.sel&&S.byId.has(st.sel))S.sel=st.sel;
  S.grav=st.g==='1';S.heat=st.heat==='1';
  buildChips();
  buildCy(tg);
  wire();
  $('grav').classList.toggle('on',S.grav);$('heat').classList.toggle('on',S.heat);
  if(S.cursorB!=null)setCompare(true,true);
  render();
  if(S.sel)showBiography(S.sel);else detailEmpty();
  S.cy.fit(undefined,40);
  if(S.grav)runGravityLayout();
  window.__chronoDebug={cy:S.cy,state:S}; // scripted checks drive this directly
  if(tg.live)startLivePoll(tg.gitHead);
}
// P3 live re-annotate: only 'viz --serve' sets tg.live (never the static site
// build). A cheap poll (git rev-parse HEAD only, no graph rebuild) decides
// whether anything moved; since the whole view already round-trips through the
// URL (P1), a plain reload picks up the fresh index without losing state.
function startLivePoll(headAtLoad){
  let last=headAtLoad;
  setInterval(async()=>{
    try{
      const r=await fetch('/code-browser-version');
      if(!r.ok)return;
      const{head}=await r.json();
      if(head&&head!==last){last=head;location.reload();}
    }catch{/* offline/stopped server — stay on the current view */}
  },5000);
}
function shortAt(i){const c=S.tg.commits[i];return c?c.shortSha:String(i);}
// every state commit rewrites the URL — the view IS the link (history.replaceState)
function syncUrl(){
  const defTypes=TYPES.filter(t=>!DEFAULT_OFF.has(t)).join(',');
  const curTypes=TYPES.filter(t=>S.enabled.has(t)).join(',');
  const qs=encodeViewState({q:S.q,at:S.cursor===S.head?'':shortAt(S.cursor),b:S.cursorB==null?'':shortAt(S.cursorB),types:curTypes===defTypes?'':curTypes,deg:S.minDeg,sel:S.sel||'',g:S.grav?'1':'',heat:S.heat?'1':''});
  const keep=new URLSearchParams(location.search).get('data');
  const full=(keep?'data='+encodeURIComponent(keep)+(qs?'&':''):'')+qs;
  history.replaceState(null,'',full?('?'+full):location.pathname);
}
// Legend chips per type GROUP — Function/Method share one chip (legend-only
// merge; node fills stay distinct), counts summed across the group.
const GROUPS=[['Module'],['Class'],['Function','Method'],['Attribute'],['GlobalVariable'],['Commit']];
function buildChips(){
  $('legend').innerHTML=GROUPS.map(g=>'<label class="lg" title="show/hide '+g.join('/')+' nodes"><input type="checkbox" class="typechk" data-cls="'+g.join(',')+'"'+(g.every(t=>S.enabled.has(t))?' checked':'')+'>'+g.map(t=>'<i style="background:'+COLORS[t]+'"></i>').join('')+g.join('/')+'<span class="cnt" data-cnt="'+g.join(',')+'"></span></label>').join(' ');
  document.querySelectorAll('.typechk').forEach(c=>c.addEventListener('change',()=>{c.dataset.cls.split(',').forEach(t=>c.checked?S.enabled.add(t):S.enabled.delete(t));render();}));
}
function buildCy(tg){
  const els=[];
  for(const n of tg.nodes)els.push({data:{id:n.id,label:n.label,type:n.type,color:COLORS[n.type]||'#8a8f98'}});
  let i=0;for(const e of tg.edges)els.push({data:{id:'e'+(i++),source:e.src,target:e.dst,kind:e.kind}});
  S.cy=cytoscape({container:$('cy'),elements:els,style:[
    // heat rides the UNDERLAY (a warm single-hue halo, opacity = recency-weighted churn)
    // so type identity (the fill) and diff status (the border) are never impersonated
    {selector:'node',style:{'background-color':'data(color)',label:'data(label)',color:'#fff','font-size':9,'min-zoomed-font-size':8,'text-outline-color':'#000','text-outline-width':2,'text-wrap':'wrap','text-max-width':110,width:16,height:16,'underlay-color':'#ff9e64','underlay-opacity':0,'underlay-padding':4}},
    {selector:"node[type = 'Commit']",style:{shape:'diamond','font-size':8}},
    {selector:'edge',style:{width:1,'line-color':'#3b4261','target-arrow-color':'#3b4261','target-arrow-shape':'triangle','curve-style':'bezier','arrow-scale':0.7}},
    {selector:"edge[kind = 'touchesSymbol']",style:{'line-color':'#565f89','line-style':'dashed'}},
    {selector:"edge[kind = 'cochange']",style:{'line-color':'#9085e9','line-style':'dotted'}},
    {selector:'.sel',style:{'border-width':3,'border-color':'#fff','z-index':99}},
    // diff status rides BORDERS so type identity (the fill) is never impersonated
    {selector:'.diff-added',style:{'border-width':3,'border-color':'#4fd67a'}},
    {selector:'.diff-changed',style:{'border-width':3,'border-color':'#e0af68'}},
    {selector:'.diff-removed',style:{'border-width':3,'border-color':'#f7768e','border-style':'dashed'}},
    {selector:'.diff-bg',style:{opacity:0.22}},
    {selector:'edge.diff-wired',style:{width:2,'line-color':'#4fd67a','target-arrow-color':'#4fd67a'}}
  ],layout:{name:'cose',animate:false,nodeRepulsion:6000,idealEdgeLength:60},wheelSensitivity:0.2});
  S.cy.on('tap','node',ev=>{S.sel=ev.target.id();showBiography(S.sel);syncUrl();});
  S.cy.on('tap',ev=>{if(ev.target===S.cy){S.sel=null;S.cy.$('.sel').removeClass('sel');detailEmpty();syncUrl();}});
}
// core render: visibility from interval x types x declutter x query; diff classes in compare mode
function render(){
  const cy=S.cy,idx=S.cursor;
  const cmp=S.cursorB!=null;
  const lo=cmp?Math.min(idx,S.cursorB):idx, hi=cmp?Math.max(idx,S.cursorB):idx;
  const d=cmp?structuralDiff(S.tg,lo,hi):null;
  const added=d?new Set(d.added):null, removed=d?new Set(d.removed):null, changed=d?new Set(d.changed):null;
  const wired=d?new Set(d.wired.map(e=>e.src+'|'+e.dst+'|'+e.kind)):null;
  // heat is paused in compare mode: the diff owns the attention channel there
  const hs=(S.heat&&!cmp)?heatScale(S.tg,idx):null;
  const grav=S.grav?gravityAt(S.tg,hi):null;
  const gW=grav?new Map(grav.map(e=>[e.src+'|'+e.dst,e.w])):null;
  const gMax=grav&&grav.length?Math.max(...grav.map(e=>e.w)):1;
  cy.batch(()=>{
    cy.nodes().forEach(cn=>{
      const n=S.byId.get(cn.id());
      const typeOk=S.enabled.has(n.type);
      const degOk=n.type==='Commit'||n.degree>=S.minDeg;
      const qOk=!S.qSet||S.qSet.size===0||S.qSet.has(n.id);
      // compare mode shows the UNION of both cursors so removed things stay visible
      const alive=cmp?(aliveAt([n.born,n.died],lo)||aliveAt([n.born,n.died],hi)):aliveAt([n.born,n.died],idx);
      const vis=typeOk&&degOk&&alive&&qOk;
      cn.style('display',vis?'element':'none');
      cn.removeClass('diff-added diff-changed diff-removed diff-bg');
      if(vis&&cmp&&n.type!=='Commit'){
        if(added.has(n.id))cn.addClass('diff-added');
        else if(removed.has(n.id))cn.addClass('diff-removed');
        else if(changed.has(n.id))cn.addClass('diff-changed');
        else cn.addClass('diff-bg');
      }
      if(vis&&n.type!=='Commit'){
        const c=churnUpTo(n.touches,hi);
        const size=14+Math.min(26,Math.sqrt(c)*6);
        cn.style('width',size);cn.style('height',size);
        cn.style('opacity',(!cmp&&n.born===idx)?1:(cn.hasClass('diff-bg')?0.22:0.92));
      }
      const h=hs?(hs.get(cn.id())||0):0;
      cn.style('underlay-opacity',h>0.03?0.14+0.42*h:0);
      if(h>0.03)cn.style('underlay-padding',2+9*h);
    });
    cy.edges().forEach(ce=>{
      const s=S.byId.get(ce.data('source')),t=S.byId.get(ce.data('target'));
      const bothVis=cy.getElementById(s.id).style('display')==='element'&&cy.getElementById(t.id).style('display')==='element';
      const alive=hi>=Math.max(s.born,t.born);
      ce.style('display',bothVis&&alive?'element':'none');
      ce.removeClass('diff-wired');
      if(cmp&&wired.has(s.id+'|'+t.id+'|'+ce.data('kind')))ce.addClass('diff-wired');
      if(ce.data('kind')==='cochange'){
        const w=gW?(gW.get(s.id+'|'+t.id)??gW.get(t.id+'|'+s.id)??0):0;
        ce.style('width',w?1+3*(w/gMax):1);
        ce.style('opacity',S.grav?(w?0.95:0.35):1);
      }
    });
  });
  // live per-type visible/loaded counts (depth-free here: interval+filters decide)
  const vis={},tot={};
  S.tg.nodes.forEach(n=>{tot[n.type]=(tot[n.type]||0)+1;});
  cy.nodes().forEach(cn=>{if(cn.style('display')==='element'){const t=cn.data('type');vis[t]=(vis[t]||0)+1;}});
  document.querySelectorAll('.cnt').forEach(sp=>{const ks=sp.dataset.cnt.split(',');sp.textContent=ks.reduce((a,k)=>a+(vis[k]||0),0)+'/'+ks.reduce((a,k)=>a+(tot[k]||0),0);});
  // narration: single cursor = the commit's story; two cursors = the range's story
  $('narr').textContent=cmp?narrateRange(S.tg,lo,hi):narrateCommit(S.tg,idx);
  $('qnote').style.display=(S.qSet&&S.qSet.size===0)?'block':'none';
  if(S.qSet&&S.qSet.size===0)$('qnote').textContent='query "'+S.q+'" matched nothing — showing the default view.';
  drawTimeline();
  syncUrl();
}
// co-change gravity: re-run the layout with cochange springs weighted by shared
// touching commits up to the cursor — clusters tighten as the cursor advances.
// Layout runs on SETTLE (toggle, drag-end, key move, play stop), never per-frame.
let gravTimer=null;
function gravityKick(){if(!S.grav)return;clearTimeout(gravTimer);gravTimer=setTimeout(runGravityLayout,350);}
function runGravityLayout(){
  const hi=S.cursorB!=null?Math.max(S.cursor,S.cursorB):S.cursor;
  const g=gravityAt(S.tg,hi);
  const wByKey=new Map(g.map(e=>[e.src+'|'+e.dst,e.w]));
  const maxW=g.length?Math.max(...g.map(e=>e.w)):1;
  const wOf=e=>{const a=e.data('source'),b=e.data('target');return wByKey.get(a+'|'+b)??wByKey.get(b+'|'+a)??0;};
  const vis=S.cy.elements().filter(el=>el.style('display')==='element');
  vis.layout({name:'cose',animate:false,nodeRepulsion:6000,
    idealEdgeLength:e=>{const w=e.data('kind')==='cochange'?wOf(e):0;return w?Math.max(24,120-96*(w/maxW)):90;},
    edgeElasticity:e=>{const w=e.data('kind')==='cochange'?wOf(e):0;return w?8+40*(w/maxW):4;}
  }).run();
}
function setCompare(on,skipRender){
  if(on){if(S.cursorB==null)S.cursorB=Math.max(0,S.cursor-1);$('cmp').classList.add('on');$('abpick').style.display='';$('difflegend').style.display='inline-flex';S.active='b';}
  else{S.cursorB=null;$('cmp').classList.remove('on');$('abpick').style.display='none';$('difflegend').style.display='none';S.active='a';}
  $('pickA').classList.toggle('on',S.active==='a');$('pickB').classList.toggle('on',S.active==='b');
  if(!skipRender)render();
}
function wire(){
  $('cmp').addEventListener('click',()=>setCompare(S.cursorB==null));
  $('grav').addEventListener('click',()=>{S.grav=!S.grav;$('grav').classList.toggle('on',S.grav);render();if(S.grav)runGravityLayout();});
  $('heat').addEventListener('click',()=>{S.heat=!S.heat;$('heat').classList.toggle('on',S.heat);render();});
  $('pickA').addEventListener('click',()=>{S.active='a';$('pickA').classList.add('on');$('pickB').classList.remove('on');});
  $('pickB').addEventListener('click',()=>{S.active='b';$('pickB').classList.add('on');$('pickA').classList.remove('on');});
  $('deg').addEventListener('input',e=>{S.minDeg=Math.max(0,+e.target.value||0);render();});
  let qt=null;
  $('q').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{S.q=e.target.value.trim();S.qSet=matchQuery(S.tg,S.q);render();},250);});
  $('reset').addEventListener('click',()=>S.cy.fit(undefined,40));
  $('zoomin').addEventListener('click',()=>S.cy.zoom({level:S.cy.zoom()*1.2,renderedPosition:{x:S.cy.width()/2,y:S.cy.height()/2}}));
  $('zoomout').addEventListener('click',()=>S.cy.zoom({level:S.cy.zoom()/1.2,renderedPosition:{x:S.cy.width()/2,y:S.cy.height()/2}}));
  $('play').addEventListener('click',togglePlay);
  const canvas=$('tlcanvas');
  const seek=x=>{const r=canvas.getBoundingClientRect();const f=Math.min(1,Math.max(0,(x-r.left)/r.width));const i=Math.round(f*S.head);
    if(S.cursorB!=null&&S.active==='b')S.cursorB=i;else S.cursor=i;render();};
  let drag=false;
  canvas.addEventListener('mousedown',e=>{drag=true;stopPlay();seek(e.clientX);});
  window.addEventListener('mousemove',e=>{if(drag)seek(e.clientX);});
  window.addEventListener('mouseup',()=>{if(drag)gravityKick();drag=false;});
  window.addEventListener('resize',drawTimeline);
  // P3 keyboard graph-nav: focus-trapped via the native <dialog> (Esc/backdrop/×
  // all close it; focus returns to whatever opened it — no bespoke trap code).
  const help=$('helpdlg');
  let helpOpener=null;
  const openHelp=()=>{helpOpener=document.activeElement;help.showModal();};
  const closeHelp=()=>{help.close();if(helpOpener&&helpOpener.focus)helpOpener.focus();helpOpener=null;};
  $('help').addEventListener('click',openHelp);
  $('helpclose').addEventListener('click',closeHelp);
  help.addEventListener('cancel',e=>{e.preventDefault();closeHelp();}); // Esc → our close (restores focus)
  window.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
    if(help.open){if(e.key==='Escape')closeHelp();return;} // dialog owns the keyboard while open
    const move=dir=>{stopPlay();if(S.cursorB!=null&&S.active==='b')S.cursorB=Math.min(S.head,Math.max(0,S.cursorB+dir));else S.cursor=Math.min(S.head,Math.max(0,S.cursor+dir));render();gravityKick();};
    if(e.key==='ArrowRight')move(1);
    else if(e.key==='ArrowLeft')move(-1);
    else if(e.key===' '){e.preventDefault();togglePlay();}
    else if(e.key==='Escape'){S.sel=null;S.cy.$('.sel').removeClass('sel');detailEmpty();S.cy.fit(undefined,40);syncUrl();}
    else if(e.key==='?'){openHelp();}
    else if(e.key==='Enter'){e.preventDefault();S.sel?$('detail').focus():selectDefault();}
    else if(e.key===']')jumpNeighbor('out');
    else if(e.key==='[')jumpNeighbor('in');
  });
}
// go-to-definition across the whole graph (PLAN_CODE_BROWSER.md §core-experience 7):
// [ / ] cycle a selected node's structural neighbours via the pure, tested
// neighborsOf(); Enter with nothing selected picks the highest-degree VISIBLE
// symbol so keyboard-only users have a deterministic way in without a mouse.
function selectDefault(){
  const vis=S.cy.nodes().filter(n=>n.style('display')==='element'&&n.data('type')!=='Commit');
  if(!vis.length)return;
  let best=vis[0];
  vis.forEach(n=>{const nn=S.byId.get(n.id()),bb=S.byId.get(best.id());if(nn&&bb&&nn.degree>bb.degree)best=n;});
  S.sel=best.id();showBiography(S.sel);S.cy.center(best);syncUrl();
}
let navKey=null;
function jumpNeighbor(dir){
  if(!S.sel)return selectDefault();
  const list=neighborsOf(S.tg,S.sel,dir);
  if(!list.length)return;
  if(!navKey||navKey.id!==S.sel||navKey.dir!==dir)navKey={id:S.sel,dir,i:-1};
  navKey.i=(navKey.i+1)%list.length;
  const nid=list[navKey.i];
  if(!S.byId.has(nid))return;
  S.sel=nid;showBiography(nid);
  const cn=S.cy.getElementById(nid);
  if(cn&&cn.length)S.cy.center(cn);
  syncUrl();
}
let playTimer=null;
function togglePlay(){S.playing?stopPlay():startPlay();}
function startPlay(){S.playing=true;$('play').textContent='❚❚ pause';if(S.cursor>=S.head)S.cursor=0;
  playTimer=setInterval(()=>{if(S.cursor>=S.head){stopPlay();return;}S.cursor+=1;render();},550);}
function stopPlay(){S.playing=false;$('play').textContent='▶ play';if(playTimer){clearInterval(playTimer);playTimer=null;}gravityKick();}
function drawTimeline(){
  const canvas=$('tlcanvas'),dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth,h=canvas.clientHeight;
  canvas.width=w*dpr;canvas.height=h*dpr;
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const n=S.tg.commits.length;
  const bornAt=new Array(n).fill(0);
  for(const nd of S.tg.nodes)if(nd.type!=='Commit')bornAt[nd.born]=(bornAt[nd.born]||0)+1;
  const maxBorn=Math.max(1,...bornAt);
  const x=i=>n<=1?w/2:(i/(n-1))*(w-12)+6;
  for(let i=0;i<n;i++){const bh=(bornAt[i]/maxBorn)*(h-16);
    ctx.fillStyle=i<=S.cursor?'#3d59a1':'#2a2e42';ctx.fillRect(x(i)-2,h-6-bh,4,bh);}
  ctx.strokeStyle='#2a2e42';ctx.beginPath();ctx.moveTo(0,h-6);ctx.lineTo(w,h-6);ctx.stroke();
  // P3 ghost-branch merges: a small muted tick above the bar marks a merge commit —
  // a NEUTRAL colour (not one of the type/diff/heat channels) so it never competes
  // with the borders that already carry meaning there.
  ctx.fillStyle='#565f89';
  for(let i=0;i<n;i++)if(S.tg.commits[i]&&S.tg.commits[i].merge){const cx=x(i);ctx.fillRect(cx-1,2,2,6);}
  const drawCursor=(i,color,tag)=>{const cx=x(i);
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,10);ctx.lineTo(cx,h-2);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(cx,10,4,0,Math.PI*2);ctx.fill();
    ctx.font='9px system-ui';ctx.fillText(tag,cx+6,12);};
  if(S.cursorB!=null)drawCursor(S.cursorB,'#e0af68','B');
  drawCursor(S.cursor,'#7aa2f7',S.cursorB!=null?'A':'');
  const c=S.tg.commits[S.cursor];
  const mergeNote=c&&c.merge?' <span style="color:#565f89">· ⑂ merge ('+(c.parentIdx.length+c.ghostParents)+' parent'+((c.parentIdx.length+c.ghostParents)===1?'':'s')+')</span>':'';
  $('tlmeta').innerHTML=(c?('<b>'+esc(c.shortSha)+'</b> · '+(c.date||'').slice(0,10)+' · '+esc(c.author)+' — '+esc(c.subject)):'')
    +mergeNote
    +(c&&c.repo?' <span style="color:#7aa2f7">· ⛃ '+esc(c.repo)+'</span>':'')
    +(S.cursorB!=null?' <span style="color:#e0af68">· B: '+esc(shortAt(S.cursorB))+'</span>':'')
    +' <span style="color:#565f89">('+(S.cursor+1)+' / '+S.tg.commits.length+')</span>';
}
function nodeUrl(n){
  if(!S.tg.repoUrl)return null;
  if(n.type==='Commit'&&n.id.startsWith('commit:'))return S.tg.repoUrl+'/-/commit/'+n.id.slice(7);
  if(n.site){const i=n.site.lastIndexOf(':');return S.tg.repoUrl+'/-/blob/'+S.tg.repoRef+'/'+n.site.slice(0,i)+'#L'+n.site.slice(i+1);}
  if(n.id.startsWith('mod:'))return S.tg.repoUrl+'/-/blob/'+S.tg.repoRef+'/'+n.id.slice(4);
  return null;
}
function detailEmpty(){
  $('detail').innerHTML='<p class="empty">Click a node for its biography, or press <kbd>Enter</kbd> to select one (see <kbd>?</kbd> for the full key map).<br>Drag the timeline to scrub; ▶ plays the history — a small tick above the bar marks a merge commit.<br><b>compare</b> pins cursor A and moves B — the graph shows what the range added (green), changed (amber) and removed (red).<br><b>gravity</b> pulls co-changing symbols into clusters (tightening as the cursor advances); <b>heat</b> paints recency-weighted churn as a warm halo.<br>Query grammar: <code>type:Class</code> · <code>touched:&gt;N</code> · <code>since:&lt;sha&gt;</code> · <code>cochange:&lt;name&gt;</code> · free words match name/path.<br>The URL always encodes the exact view — copy it to share.</p>'
    +'<p class="hint">'+S.tg.nodes.length+' nodes · '+S.tg.edges.length+' edges · scope '+esc(S.tg.meta&&S.tg.meta.scope||'')+'</p>';
}
function showBiography(id){
  const cy=S.cy;cy.$('.sel').removeClass('sel');cy.getElementById(id).addClass('sel');
  const n=S.byId.get(id);if(!n)return;
  const bornC=S.tg.commits[n.born];
  const url=nodeUrl(n);
  if(n.type==='Commit'){
    const c=S.tg.commits[n.commitIdx];
    const touched=S.tg.edges.filter(e=>e.src===id&&e.kind==='touchesSymbol').map(e=>S.byId.get(e.dst)).filter(Boolean);
    // P3 ghost-branch merges: parents present on the timeline are jump-to; parents
    // whose own commits never touched a tracked symbol surface as a ghost count —
    // the branch existed, we just can't scrub INTO it (HEAD-only index, same
    // honesty rule as the rest of the panel).
    const parentsHtml=c.parentIdx.length||c.ghostParents
      ?'<h4>'+(c.merge?'⑂ merge — ':'')+(c.parentIdx.length+c.ghostParents)+' parent(s)</h4><ul>'
        +c.parentIdx.map(pi=>'<li><a href="#" class="jump-parent" data-idx="'+pi+'"><code>'+esc(S.tg.commits[pi].shortSha)+'</code></a></li>').join('')
        +(c.ghostParents?'<li class="hint">+'+c.ghostParents+' ghost parent(s) — untracked commit(s), branch not otherwise visible</li>':'')
        +'</ul>'
      :'';
    $('detail').innerHTML='<h3>'+esc(c.shortSha)+'</h3>'
      +'<span class="badge"><i style="background:'+COLORS.Commit+'"></i>Commit '+(c.idx+1)+' of '+S.tg.commits.length+'</span>'
      +(c.repo?' <span class="badge">repo '+esc(c.repo)+'</span>':'')
      +'<div class="row">'+esc(c.author)+' · '+(c.date||'').slice(0,10)+'</div><div class="row"><em>'+esc(c.subject)+'</em></div>'
      +'<div class="row">'+(url?'<a class="btn" href="'+url+'" target="_blank" rel="noopener">open in GitLab ↗</a>':'')
      +'<button class="btn" id="gocommit">scrub here</button></div>'
      +parentsHtml
      +'<h4>touched '+touched.length+' symbol(s)</h4><ul>'+touched.slice(0,25).map(t=>'<li>'+esc(t.label)+'</li>').join('')+'</ul>';
    $('gocommit').addEventListener('click',()=>{S.cursor=c.idx;render();});
    $('detail').querySelectorAll('.jump-parent').forEach(a=>a.addEventListener('click',e=>{
      e.preventDefault();S.cursor=+a.dataset.idx;S.sel='commit:'+S.tg.commits[+a.dataset.idx].sha;render();showBiography(S.sel);
    }));
    return;
  }
  const outE=S.tg.edges.filter(e=>e.src===id&&e.kind!=='touchesSymbol');
  const inE=S.tg.edges.filter(e=>e.dst===id&&e.kind!=='touchesSymbol');
  const touchers=S.tg.edges.filter(e=>e.dst===id&&e.kind==='touchesSymbol').map(e=>S.byId.get(e.src)).filter(Boolean);
  const lbl=nid=>esc(S.byId.get(nid)?.label||nid);
  $('detail').innerHTML='<h3>'+esc(n.label)+'</h3>'
    +'<span class="badge"><i style="background:'+(COLORS[n.type]||'#8a8f98')+'"></i>'+esc(n.type)+'</span>'
    +(n.site?'<div class="row"><code>'+esc(n.site)+'</code></div>':'')
    +'<div class="row">'+(url?'<a class="btn" href="'+url+'" target="_blank" rel="noopener">open in GitLab ↗</a>':'')
    +'<button class="btn" id="gobirth">jump to birth</button></div>'
    +'<h4>life</h4><div>born at <b>'+(bornC?esc(bornC.shortSha):'?')+'</b>'+(bornC?' — '+esc(bornC.subject):'')+'</div>'
    +'<div>churn '+n.churn+' touching commit(s) · degree '+n.degree+'</div>'
    +'<h4>touched by '+touchers.length+' commit(s)</h4><ul>'+ (touchers.slice(0,10).map(c=>'<li><code>'+esc(c.label)+'</code></li>').join('')||'<li class="hint">no direct history (born = first-seen)</li>')+'</ul>'
    +'<h4>edges out ('+outE.length+')</h4><ul>'+(outE.slice(0,15).map(e=>'<li>'+esc(e.kind)+' → '+lbl(e.dst)+'</li>').join('')||'<li class="hint">none</li>')+'</ul>'
    +'<h4>edges in ('+inE.length+')</h4><ul>'+(inE.slice(0,15).map(e=>'<li>'+lbl(e.src)+' → '+esc(e.kind)+'</li>').join('')||'<li class="hint">none</li>')+'</ul>';
  $('gobirth').addEventListener('click',()=>{S.cursor=n.born;render();});
}
loadData().then(init).catch(err=>{
  $('detail').innerHTML='<p class="empty">Failed to load the temporal graph: '+esc(err.message)
    +'</p><p class="hint">Serve a code-browser-data.json next to this page, pass ?data=&lt;url&gt;, or regenerate with seonix viz --browser-out.</p>';
});
</script></body></html>`;
}

/** Convenience: load the temporal source and render (the async front door). */
export async function renderBrowserHtml({ cytoscape, embedData = null, dataPath = null } = {}) {
  return renderBrowserPage({ cytoscape, temporal: await temporalSource(), embedData, dataPath });
}
