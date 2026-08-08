// feed-normalize.mjs — turns raw feed text (RSS 2.0, Atom, JSON Feed 1.1) into
// normalized item snapshots. String scanning throughout: a domain module may
// import nothing beyond another domain module (test/estate/import-layers.test.mjs),
// which rules out DOMParser and any XML package, so every parser here reads a
// feed the same way both sibling repos already do (PLAN_NEWS_FEED.md section 5).
// The parsers are lenient by construction — an unparseable block is skipped,
// never thrown — because a feed on the open internet is never fully well-formed.

import { sha256Bytes } from "./hash.mjs";

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    const key = body.toLowerCase();
    return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
  });
}

/** Strips tags and CDATA wrappers, decodes entities, collapses whitespace.
 *  The first half of the two-layer sanitisation rule (constitution section 3):
 *  strip at parse time, escape again at render time. A `<script>` block loses
 *  its tags here same as any other markup; what is left is inert plain text. */
export function stripMarkup(text) {
  let s = String(text ?? "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Decoded BEFORE tags are stripped: an Atom summary/content declared
  // type="html" carries its markup entity-escaped ("&lt;p&gt;"), and only
  // decoding first turns that back into real tags this function can then
  // remove. Literal markup (the CDATA-unwrapped case above) is unaffected by
  // the ordering, since it has no entities standing in for its tags.
  s = decodeEntities(s);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** "rss" | "atom" | "jsonfeed" | null, decided from the text's own shape. */
export function detectFeedFormat(text) {
  const s = String(text ?? "");
  const trimmed = s.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const version = typeof parsed?.version === "string" ? parsed.version : "";
      if (version.startsWith("https://jsonfeed.org/")) return "jsonfeed";
    } catch {
      // not JSON at all — fall through to the XML checks below
    }
  }
  if (/<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(s)) return "atom";
  if (/<rss\b/i.test(s) || /<channel\b/i.test(s)) return "rss";
  return null;
}

function sha256HexPrefix(str, nBytes) {
  const bytes = sha256Bytes(str);
  let hex = "";
  for (let i = 0; i < nBytes; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** `news-item:${sha256Hex(sourceId\0guidOrUrl, 8)}` — content-addressed so
 *  re-fetching the same item across polls upserts rather than duplicating. */
export function feedItemId(sourceId, guidOrUrl) {
  return `news-item:${sha256HexPrefix(`${sourceId}\0${guidOrUrl}`, 8)}`;
}

function firstTagContent(block, tagNames) {
  for (const name of tagNames) {
    const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
    if (match) return match[1];
  }
  return "";
}

function normalizeDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/** [{ guid, title, url, summary, publishedAt }], document order, capped at
 *  `limit`. Reads `<guid>`, `<title>`, `<link>`, `<description>`, `<pubDate>`
 *  else `<dc:date>` off each `<item>` block — the RSS 2.0 core plus the one
 *  Dublin Core fallback real-world feeds actually carry. */
export function parseRss(text, { limit = 50 } = {}) {
  const items = [];
  const blockRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while (items.length < limit && (match = blockRe.exec(String(text ?? "")))) {
    try {
      const block = match[1];
      items.push({
        guid: stripMarkup(firstTagContent(block, ["guid"])),
        title: stripMarkup(firstTagContent(block, ["title"])),
        url: stripMarkup(firstTagContent(block, ["link"])),
        summary: stripMarkup(firstTagContent(block, ["description"])),
        publishedAt: normalizeDate(stripMarkup(firstTagContent(block, ["pubDate", "dc:date"]))),
      });
    } catch {
      // a malformed <item> block is skipped, never thrown
    }
  }
  return items;
}

function extractAtomLink(block) {
  const linkRe = /<link\b([^>]*?)\/?>/gi;
  let fallback = "";
  let match;
  while ((match = linkRe.exec(block))) {
    const attrs = match[1];
    const hrefMatch = /href\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (!hrefMatch) continue;
    const relMatch = /rel\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const rel = relMatch ? relMatch[1] : "alternate";
    if (rel === "alternate") return hrefMatch[1];
    if (!fallback) fallback = hrefMatch[1];
  }
  return fallback;
}

/** [{ guid, title, url, summary, publishedAt }], document order, capped at
 *  `limit`. Reads `<id>`, `<title>`, `<link href>` (rel="alternate" preferred),
 *  `<summary>` else `<content>`, `<updated>` else `<published>` off each
 *  `<entry>` block. */
export function parseAtom(text, { limit = 50 } = {}) {
  const items = [];
  const blockRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  while (items.length < limit && (match = blockRe.exec(String(text ?? "")))) {
    try {
      const block = match[1];
      items.push({
        guid: stripMarkup(firstTagContent(block, ["id"])),
        title: stripMarkup(firstTagContent(block, ["title"])),
        url: stripMarkup(extractAtomLink(block)),
        summary: stripMarkup(firstTagContent(block, ["summary", "content"])),
        publishedAt: normalizeDate(stripMarkup(firstTagContent(block, ["updated", "published"]))),
      });
    } catch {
      // a malformed <entry> block is skipped, never thrown
    }
  }
  return items;
}

/** [{ guid, title, url, summary, publishedAt }], document order, capped at
 *  `limit`. JSON Feed 1.1's own field names; `content_text` wins over
 *  `stripMarkup(content_html)` over `summary`, per the spec's own precedence. */
export function parseJsonFeed(text, { limit = 50 } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ""));
  } catch {
    return [];
  }
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
  const items = [];
  for (const raw of rawItems) {
    if (items.length >= limit) break;
    if (!raw || typeof raw !== "object") continue;
    const summary = raw.content_text
      ?? (raw.content_html ? stripMarkup(raw.content_html) : "")
      ?? raw.summary
      ?? "";
    items.push({
      guid: String(raw.id ?? ""),
      title: stripMarkup(String(raw.title ?? "")),
      url: String(raw.url ?? ""),
      summary: stripMarkup(String(summary)),
      publishedAt: normalizeDate(raw.date_published),
    });
  }
  return items;
}

/** Dispatches to the right parser, auto-detecting the format when none is
 *  given. An unrecognised format yields an empty list, never a throw. */
export function parseFeed(text, { format = null, limit = 50 } = {}) {
  const fmt = format || detectFeedFormat(text);
  if (fmt === "rss") return parseRss(text, { limit });
  if (fmt === "atom") return parseAtom(text, { limit });
  if (fmt === "jsonfeed") return parseJsonFeed(text, { limit });
  return [];
}

/** Raw parsed items -> snapshot records (PLAN_NEWS_FEED.md section 6.2),
 *  `fetchedAt` stamped from the caller's `now`, deduped by content-addressed
 *  id, document order kept, capped at `limit`. */
export function normalizeFeedItems(sourceId, rawItems, { now = "", limit = Infinity } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of rawItems ?? []) {
    if (out.length >= limit) break;
    const guidOrUrl = raw?.guid || raw?.url || "";
    if (!guidOrUrl) continue;
    const id = feedItemId(sourceId, guidOrUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      sourceId,
      title: raw.title || "",
      url: raw.url || "",
      summary: raw.summary || "",
      publishedAt: raw.publishedAt || "",
      fetchedAt: now,
      bytes: 0,
      processedRounds: 0,
      factIds: [],
      extras: null,
    });
  }
  return out;
}
