// The demo site's page list, in one place.
//
// Several independent things need to know which demo pages exist and in what
// order: the home page's claim grid and feature sections, the service worker's
// precache set, the e2e snapshot's copy list, and the tests that assert the
// home page shows one of each. Each of those used to keep its own array, so
// adding a page meant finding all of them and a page missed one list silently.
//
// DEMO_PAGES is the order the home page reads in. ABOUT_PAGES is derived from
// it, never typed out again. DEMO_PAGES itself stays a plain slug list — every
// existing reader (aboutPageOf below, the service worker's precache set, the
// e2e page-order tests) treats an entry as a string — so the head-tag
// metadata each slug now carries rides in DEMO_PAGE_META instead, keyed by
// the same slugs, rather than reshaping DEMO_PAGES's own entries.

export const DEMO_PAGES = [
  "chat",
  "news",
  "sprites",
  "ledger",
  "plan",
  "mudiii",
  "adventure",
];

/** The hand-authored about page beside each demo page. */
export const aboutPageOf = (page) => `${page}-about.html`;

export const ABOUT_PAGES = DEMO_PAGES.map(aboutPageOf);

/** Every hand-authored, git-tracked page/asset the site serves. The generated
 *  demo pages are not here: they are written fresh by build-demo-site.mjs. */
export const TRACKED_PAGES = ["index.html", "help.html", ...ABOUT_PAGES];

export const SHARED_STYLESHEET = "site.css";

/** Per-slug head-tag metadata: the title and description build-demo-site.mjs
 *  puts into <title>, <meta name="description">, og:title/og:description and
 *  twitter:image on both a demo page and its about page. Each description is
 *  copied verbatim from that slug's own <slug>-about.html, the only place any
 *  of these pages carried one before. */
export const DEMO_PAGE_META = {
  chat: {
    title: "Ask it anything, check every answer",
    description: "How tmct reads a plain English question and answers it from a graph, deterministically and offline, in your browser.",
  },
  news: {
    title: "A feed that only ships what grounds",
    description: "How tmct polls news sources on your say-so, grounds what it can against the graph, and ranks what it can't as the work still to do.",
  },
  plan: {
    title: "Watch it solve a puzzle it was taught",
    description: "How tmct solves the Tower of Hanoi with a bounded breadth-first search and shows the plan as PDDL and OWL triples.",
  },
  adventure: {
    title: "A house drawn only from what its facts say",
    description: "How Ashcombe Hall draws a room from its own facts and nothing else, and how an auto-player works out its own goal.",
  },
  ledger: {
    title: "Every fact, its source, and how far to trust it",
    description: "How tmct stores memory as RDF triples with OWL labels, and shows where every fact came from and how far to trust it.",
  },
  sprites: {
    title: "Concepts rendered using the ontology inheritance",
    description: "How tmct picks a shape for a word by walking the class hierarchy until it finds one it has.",
  },
  mudiii: {
    title: "A fox and goblins in a 3D town square",
    description: "How a fox and goblins plan their own moves through a 3D town square, each acting only on what it has seen or been told.",
  },
};

/** The home page's own head-tag metadata. `title` feeds only the social tags
 *  (og:title/twitter): the page's own <title> element keeps its existing,
 *  longer text, so it stays out of this object. */
export const INDEX_META = {
  title: "the-mechanical-code-talker",
  description: "A pure-JS, no-LLM, offline, $0 chatbot in the ELIZA/PARRY lineage: mechanical interpretation, OWL graph memory, honest misses.",
};

/** The receipts page's own head-tag metadata. It carries no paired about
 *  page and sits outside DEMO_PAGES, so it gets its own entry rather than
 *  riding DEMO_PAGE_META. */
export const RECEIPTS_META = {
  title: "Receipts",
  description: "Query latency and graph and page size, measured and committed. Each figure on this page names the file it comes from.",
};

/** The claims page's own head-tag metadata. Same posture as RECEIPTS_META:
 *  no paired about page, sits outside DEMO_PAGES. */
export const CLAIMS_META = {
  title: "Claims and limits",
  description: "Every claim tmct makes about itself, measured against a committed source and rendered from that source at build time, including the ones that don't flatter it.",
};

/** The help page's own head-tag metadata. Same posture as RECEIPTS_META: no
 *  paired about page, sits outside DEMO_PAGES. */
export const HELP_META = {
  title: "Help",
  description: "How to ask and teach on chat.html, how sharing a world works, and what to do when something goes wrong.",
};

/** The claims page's block manifest: which results/claims/<name>.json file
 *  the page renders, one block per name, in this order. This is the ONLY
 *  thing declared here — the prose, the figure a block renders, and which
 *  facet of a JSON's detail it reads live in build-demo-site.mjs's
 *  renderClaimsHtml, next to the copy they support. test/estate/claims.test.mjs
 *  reads this list and asserts every name here resolves to a JSON file that
 *  exists, parses, matches scripts/claims/schema.json, and cites sources that
 *  exist in the repo — the same three checks that test already runs over
 *  every JSON file present, now also pinned to what the page promises to
 *  show. Every rig under results/claims/ publishes a block here. */
export const CLAIMS_PAGE_BLOCKS = ["planner", "prose-band", "commonsenseqa"];
