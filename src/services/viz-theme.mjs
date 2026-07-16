// viz-theme.mjs — the shared assets for tmct's generated HTML pages
// (the ledger explorer and the plan player): the visual token table
// (PLAN_VIZ_LEDGER.md's reference values) plus the escaping helpers every
// page builder needs.
//
// Trust tiers are precomputed rgba() values per provenance color so pages
// render identically on browsers without color-mix() support.

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

/** hex "#RRGGBB" -> "rgba(r, g, b, a)" */
function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const TOKENS = Object.freeze({
  light: Object.freeze({
    bg: "#F7F6F2", ink: "#23272B", muted: "#6E7168", line: "#DDD9D0", card: "#FFFFFF",
    taught: "#2E7D4F", corpus: "#5A80AC", entail: "#B07C2E", alert: "#B0503F",
  }),
  dark: Object.freeze({
    bg: "#15181C", ink: "#E7E5DF", muted: "#9A9E95", line: "#2B3036", card: "#1C2126",
    taught: "#5FBE8B", corpus: "#6C93BF", entail: "#D9A554", alert: "#D08070",
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
