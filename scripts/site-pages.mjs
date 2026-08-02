// The demo site's page list, in one place.
//
// Several independent things need to know which demo pages exist and in what
// order: the home page's claim grid and feature sections, the service worker's
// precache set, the e2e snapshot's copy list, and the tests that assert the
// home page shows one of each. Each of those used to keep its own array, so
// adding a page meant finding all of them and a page missed one list silently.
//
// DEMO_PAGES is the order the home page reads in. ABOUT_PAGES is derived from
// it, never typed out again.

export const DEMO_PAGES = [
  "chat",
  "spider-fly",
  "plan",
  "adventure",
  "ledger",
  "code",
  "ingest",
  "sprites",
  "research",
  "mud",
  "mudiii",
];

/** The hand-authored about page beside each demo page. */
export const aboutPageOf = (page) => `${page}-about.html`;

export const ABOUT_PAGES = DEMO_PAGES.map(aboutPageOf);

/** Every hand-authored, git-tracked page/asset the site serves. The generated
 *  demo pages are not here: they are written fresh by build-demo-site.mjs. */
export const TRACKED_PAGES = ["index.html", ...ABOUT_PAGES];

export const SHARED_STYLESHEET = "site.css";
