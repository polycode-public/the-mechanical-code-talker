// viz-theme.mjs — the shared assets for tmct's generated HTML pages
// (the ledger explorer and the plan player): the visual token table plus the
// escaping helpers every page builder needs.
//
// Trust tiers are precomputed rgba() values per provenance color so pages
// render identically on browsers without color-mix() support.
import { pluralOf } from "../domain/inflect.mjs";

export const SERIF_STACK = `"Charter", "Bitstream Charter", Georgia, "Times New Roman", serif`;
export const MONO_STACK = `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

/** Escape untrusted text for safe placement inside HTML content/attributes. */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** JSON-embed page data into a `<script>` tag safely — escape `</` so a
 *  label/id containing "</script>" can't break out of the tag, and escape
 *  U+2028/U+2029 (valid in JSON strings, invalid unescaped in JS source). */
export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** JS source made safe to sit inside an inline `<script>` tag. The only
 *  sequence the HTML parser can end the tag on is a literal "</script", and
 *  valid JS can only carry that inside a string/regex/comment — contexts
 *  where "<\/script" reads back identically. */
export function embedScriptText(js) {
  return String(js ?? "").replaceAll("</script", "<\\/script");
}

/** The three-link nav every demo page's header opens with: the site's own
 *  name (home), the demo's own name (its own page) and "about" (its about
 *  page). `page` is the demo's key in scripts/site-pages.mjs's DEMO_PAGES,
 *  which is also its filename stem (e.g. "mud" -> mud.html); the about-page
 *  suffix below mirrors that same file's `aboutPageOf`, restated rather than
 *  imported since scripts/ sits outside src/ and never ships with the
 *  published package. Returns the inner markup only — the caller supplies
 *  the wrapping element (div/h1/span) and keeps whatever class and
 *  neighbouring markup its own header already carries. Style hook:
 *  EYEBROW_LINKS_CSS. */
export function demoEyebrowHtml(page, label) {
  return `<span class="eyebrow-links"><a href="./index.html">tmct</a> &middot; <a href="./${page}.html">${escapeHtml(label)}</a> &middot; <a href="./${page}-about.html">about</a></span>`;
}

/** Styling every page that calls demoEyebrowHtml splices into its own inline
 *  <style>: the links read in the eyebrow's own colour (each page sets that
 *  colour itself), underlining only on hover/focus. */
export const EYEBROW_LINKS_CSS = `.eyebrow-links a { color: inherit; text-decoration: none; }
.eyebrow-links a:hover, .eyebrow-links a:focus-visible { text-decoration: underline; }`;

/** A world name read as a name in a scenario dropdown: "mud-garden" ->
 *  "mud garden". The world's own hyphenated id is the only thing every caller
 *  is guaranteed to have, so a scenario that wants a hand-written label passes
 *  one instead of leaning on this. Pure. */
export function scenarioLabel(worldName) {
  return String(worldName || "").split("-").join(" ").trim() || "world";
}

/** hex "#RRGGBB" -> "rgba(r, g, b, a)" */
function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The light/dark token table — the raw hex/alpha values `THEME_TOKENS_CSS`
 *  compiles into CSS custom properties. Exported so a page's own inlined
 *  dark-mode CSS can read a value directly instead of restating it. */
export const TOKENS = Object.freeze({
  light: Object.freeze({
    bg: "#F7F6F2", ink: "#23272B", muted: "#6E7168", line: "#DDD9D0", card: "#FFFFFF",
    taught: "#2E7D4F", corpus: "#5A80AC", entail: "#B07C2E", alert: "#B0503F",
    popRimAlpha: 0.66, popShadow: "0 1px 1.2px rgba(0, 0, 0, .30)",
  }),
  dark: Object.freeze({
    bg: "#15181C", ink: "#E7E5DF", muted: "#9A9E95", line: "#2B3036", card: "#1C2126",
    taught: "#5FBE8B", corpus: "#6C93BF", entail: "#D9A554", alert: "#D08070",
    popRimAlpha: 0.45, popShadow: "0 1px 1.4px rgba(0, 0, 0, .55)",
  }),
});

const TIER_ALPHA = [0.35, 0.65, 1.0]; // trust tiers 1..3

function tokenBlock(t) {
  const tiers = (name) =>
    TIER_ALPHA.map((a, i) => `--${name}-t${i + 1}: ${rgba(t[name], a)};`).join(" ");
  return [
    `--bg: ${t.bg}; --ink: ${t.ink}; --muted: ${t.muted}; --line: ${t.line}; --card: ${t.card};`,
    `--taught: ${t.taught}; --corpus: ${t.corpus}; --entail: ${t.entail}; --alert: ${t.alert};`,
    tiers("taught"), tiers("corpus"), tiers("entail"),
    `--taught-soft: ${rgba(t.taught, 0.12)}; --corpus-soft: ${rgba(t.corpus, 0.12)};`,
    `--entail-soft: ${rgba(t.entail, 0.14)}; --alert-soft: ${rgba(t.alert, 0.12)};`,
    // The sprite rim keys off ink so it flips with the theme: a dark edge on
    // light grounds, a faint rim-light on dark ones — the sprite holds its
    // silhouette against either without per-page tuning. Apply as
    // `filter: var(--sprite-pop)` on any element that draws a sprite SVG.
    `--sprite-pop: drop-shadow(0 0 .6px ${rgba(t.ink, t.popRimAlpha)}) drop-shadow(${t.popShadow});`,
  ].join(" ");
}

/** The token table as CSS custom properties: light by default, dark via the
 *  OS preference, and explicit data-theme overrides winning in both
 *  directions (the viewer's toggle stamps data-theme on the root). */
export const THEME_TOKENS_CSS = `
  :root { color-scheme: light dark; ${tokenBlock(TOKENS.light)} }
  @media (prefers-color-scheme: dark) { :root { ${tokenBlock(TOKENS.dark)} } }
  :root[data-theme="dark"] { ${tokenBlock(TOKENS.dark)} }
  :root[data-theme="light"] { ${tokenBlock(TOKENS.light)} }
`;

/** "N word"/"N words" — every current hand-pluralized count in the estate
 *  (`n === 1 ? "" : "s"`) is a regular plural, so this is a clean swap: pass
 *  `plural` only for the rare irregular noun. Pure. */
export function countLabel(n, singular, plural = pluralOf(singular)) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** `rows` narrowed to the ones a world's own provenance tag ("world:<name>")
 *  wrote — the same prefix filter mud.html's and adventure.html's edit modes
 *  each apply to keep a world's own facts apart from whatever background
 *  corpus shares the same live store. Pure. */
export function rowsForWorld(rows, worldName) {
  const prefix = "world:" + worldName;
  return (rows || []).filter((r) => typeof r.provenance === "string" && r.provenance.indexOf(prefix) === 0);
}

/** A generic clamped-percentage meter: `<div class="meter-track"><div
 *  class="meter-fill <cls>" style="width:N%"></div></div>`, empty when
 *  `value` isn't a number or `max` is falsy (nothing to show, not a 0%
 *  bar). `cls` rides on the inner fill for per-kind styling (e.g. a colour
 *  per creature class). Pure. */
export function meterBarHtml(cls, value, max) {
  if (typeof value !== "number" || !max) return "";
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="meter-track"><div class="meter-fill ${escapeHtml(cls)}" style="width:${pct}%"></div></div>`;
}

/** The identifier-shaped word immediately before `cursorPos` in `text`,
 *  lowercased — a cursor-suggestion pill's own lookup key. Empty when the
 *  cursor sits after whitespace/punctuation rather than a word. Pure,
 *  self-contained (no closure state), `.toString()`-splice safe. */
export function wordBeforeCursor(text, cursorPos) {
  const head = String(text || "").slice(0, cursorPos);
  const m = head.match(/[A-Za-z][A-Za-z0-9-]*$/);
  return m ? m[0].toLowerCase() : "";
}

/** Append one line to a chat/event log element: a plain-text line, dropped
 *  in with `textContent` (never `innerHTML` — the caller's text is untrusted
 *  chat/answer text, not markup) and the log scrolled to show it. `clip`
 *  (default false) turns on mud.html's own "read more" affordance: once the
 *  line is in the DOM, measure its full (unclamped) height against its
 *  actually-rendered one, and if a CSS line-clamp on `cls` is cutting it off,
 *  mark the element `clipped` (with a button role/tabindex/title) so a click
 *  or Enter can open the whole text elsewhere. `clip` is a no-op on a class
 *  with no clamping rule — nothing to detect, nothing gets marked. Returns
 *  the created element, so a caller with more to wire (a click handler) can.
 *  Self-contained, `.toString()`-splice safe. */
export function appendLogLine(el, cls, text, { clip = false } = {}) {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  el.appendChild(d);
  if (clip) {
    // A line-clamped box reports scrollHeight EQUAL to its clamped height, so
    // the overflow has to be read against the same box with the clamp lifted.
    d.classList.add("unclamped");
    const wholeHeight = d.scrollHeight;
    d.classList.remove("unclamped");
    if (wholeHeight - d.clientHeight > 2) {
      d.classList.add("clipped");
      d.setAttribute("role", "button");
      d.setAttribute("tabindex", "0");
      d.setAttribute("title", "read the whole line");
    }
  }
  el.scrollTop = el.scrollHeight;
  return d;
}
