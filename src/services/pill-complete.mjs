// pill-complete.mjs — typeahead completion over a page's own live pill set,
// shared by every page that shows grounded-command pills (adventure.html,
// mud.html, and pages not yet built). Typing "u" in the command input
// completes to "unlock cabinet" because "unlock cabinet" is a pill on
// screen right now — never because the word "unlock" looks pluasible.
//
// THE HARD CONSTRAINT: a completion the page cannot ground is a product bug,
// not a UX rough edge (tmct's whole promise is the honest miss — a query it
// cannot ground gets a refusal, never a guess). matchPills enforces this
// mechanically, not by convention:
//   1. it takes the candidate list as a plain argument every call — nothing
//      here caches a pill set across calls, so a stale "take lamp" from a
//      turn ago can never surface after the lamp left the room;
//   2. every returned match is one of the caller's own candidate objects
//      (`===`), never a new string built from typed characters;
//   3. accepting a completion (Tab/ArrowRight in createPillComplete) always
//      writes the accepted candidate's OWN `.command`, never the typed
//      prefix plus a computed suffix.
// Do not build on suggestionsForTerm in adventure-viz.mjs instead of this
// module — it returns ontology neighbours ("lamp" -> "lantern, light") that
// are grounded as vocabulary but not as affordances ("take lantern" still
// declines), which is exactly the guess this module exists to refuse. The
// two mechanisms are named differently on purpose (nothing here starts with
// "suggestions") because a page can carry both at once and they must never
// be confused for one another.
//
// SPLICE SAFETY: pages embed the runtime pieces by `.toString()`-splicing
// them into their inline IIFE, verbatim, as top-level functions. `matchPills`,
// `pillCandidates` and `createPillComplete` are written with NO reference to
// any module-level binding (no closed-over const, no import) so that
// splicing is safe — an adopting page must splice all THREE of those, under
// these exact names, because createPillComplete calls the other two by bare
// name at runtime and that call only resolves if all three sit as siblings
// in the same inline script. `pillCompleteMarkup` is different: it is a
// markup BUILDER, the same role `shareOverlayHtml` plays in
// share-overlay-viz.mjs — it runs once, server/module-side, to produce the
// initial HTML string a page embeds, and is never spliced into the client
// script. That is the only reason it may (and does) import `escapeHtml`.
//
// Only `escapeHtml` is imported from viz-theme.mjs, and only pillCompleteMarkup
// uses it, for exactly the reason above.
import { escapeHtml } from "./viz-theme.mjs";

/**
 * Normalizes a page's own pill list into `{ command, label }` pairs.
 * Accepts either shape a page already has lying around: a bare command
 * string (adventure-viz.mjs's `roomAffordances`/`pillsForRoom` return
 * `string[]`), or an object already carrying a separate `label` (mud-viz.mjs's
 * `renderChatPills` pills, where a dug object's command outranks its display
 * name — `{command:"take carrot-1", label:"take carrot"}`). A string pill's
 * label defaults to the command itself; an object pill missing `label`
 * falls back to its own `command` the same way. Pure, self-contained, no
 * outer refs — safe to call from either a splice-safe context or an
 * ordinary module-side render.
 */
export function pillCandidates(pills) {
  const out = [];
  for (const pill of pills || []) {
    if (typeof pill === "string") {
      out.push({ command: pill, label: pill });
    } else if (pill && typeof pill === "object") {
      const command = String(pill.command == null ? "" : pill.command);
      const label = pill.label == null ? command : String(pill.label);
      out.push({ command, label });
    }
  }
  return out;
}

/**
 * Matches `typed` against `candidates` (already `{command,label}` pairs —
 * pass them through pillCandidates first). Every entry `matchPills` returns
 * is `===` one of the objects in `candidates`; nothing is ever constructed
 * from `typed`'s own characters. `candidates` is read fresh on every call —
 * this function holds no state of its own, so a stale pill set is only ever
 * the caller's mistake, never this module's.
 *
 * Normalization: lowercase, collapse internal whitespace runs to one space,
 * trim the START only. Trailing whitespace on `typed` is kept on purpose —
 * "take " is a real, useful prefix of "take lamp" that a start-and-end trim
 * would destroy.
 *
 * Tier 1 (whole-string prefix) outranks tier 2 (word-boundary prefix,
 * checked only when `typed` itself contains no space — a boundary match
 * inside a multi-word typed string would be guessing which word the caret
 * means). Both tiers match against `command` OR `label`. Within a tier:
 * earlier match position first, then shorter command, then the candidate's
 * own position in the input array — so the result is a pure function of the
 * caller's own ordering, never of anything hidden in here. Capped at 8.
 *
 * Empty or whitespace-only `typed` returns `{ matches: [], top: null,
 * ghost: "", tier: null }` deliberately, not "show everything" — the rail
 * this completes against is already showing everything, and the input's own
 * placeholder already occupies those pixels.
 *
 * `ghost` is the remainder of `top.command` after the typed prefix, and is
 * only ever non-empty when the WHOLE match came from `command` itself at
 * tier 1 (not merely from `label`) — a suffix sliced off `command` only
 * means anything when `command` is what actually carried the prefix. A
 * tier-2 match has no inline suffix form at all; it surfaces through the
 * rail highlight and a live region instead.
 *
 * Self-contained, `.toString()`-splice-safe: no outer refs, tier thresholds
 * and the cap of 8 are literals in the body.
 */
export function matchPills(candidates, typed, opts = {}) {
  const cap = 8;
  const normalize = function (s) {
    return String(s == null ? "" : s).replace(/^\s+/, "").toLowerCase().replace(/\s+/g, " ");
  };
  const wordStartPosition = function (text, prefix) {
    let offset = 0;
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (words[i].indexOf(prefix) === 0) return offset;
      offset += words[i].length + 1;
    }
    return -1;
  };

  const typedNorm = normalize(typed);
  if (typedNorm.trim() === "") return { matches: [], top: null, ghost: "", tier: null };
  const hasSpace = typedNorm.indexOf(" ") !== -1;

  const scored = [];
  const list = candidates || [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    const commandNorm = normalize(candidate.command);
    const labelNorm = normalize(candidate.label);
    let tier = null;
    let position = 0;
    let commandCarriedTier1 = false;

    if (commandNorm.indexOf(typedNorm) === 0) {
      tier = 1;
      position = 0;
      commandCarriedTier1 = true;
    } else if (labelNorm.indexOf(typedNorm) === 0) {
      tier = 1;
      position = 0;
    } else if (!hasSpace) {
      const commandPos = wordStartPosition(commandNorm, typedNorm);
      const labelPos = wordStartPosition(labelNorm, typedNorm);
      if (commandPos !== -1 || labelPos !== -1) {
        tier = 2;
        position = commandPos === -1 ? labelPos : (labelPos === -1 ? commandPos : Math.min(commandPos, labelPos));
      }
    }

    if (tier === null) continue;
    scored.push({
      candidate: candidate,
      tier: tier,
      position: position,
      commandCarriedTier1: commandCarriedTier1,
      commandLen: commandNorm.length,
      index: i,
    });
  }

  scored.sort(function (a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.position !== b.position) return a.position - b.position;
    if (a.commandLen !== b.commandLen) return a.commandLen - b.commandLen;
    return a.index - b.index;
  });

  const capped = scored.slice(0, cap);
  const matches = capped.map(function (s) { return s.candidate; });
  const top = matches.length ? matches[0] : null;
  const topScored = capped.length ? capped[0] : null;
  let ghost = "";
  if (topScored && topScored.tier === 1 && topScored.commandCarriedTier1) {
    ghost = top.command.slice(typedNorm.length);
  }
  return { matches: matches, top: top, ghost: ghost, tier: topScored ? topScored.tier : null };
}

/**
 * The markup wrapper an adopting page renders once, around an `<input>` it
 * already builds itself: a positioning field, the inline ghost span
 * (`aria-hidden`, since its text is a decoration the live region already
 * announces), and a visually-hidden `aria-live="polite"` status paragraph
 * for the tier-2 case (which has no inline ghost to read). `inputHtml` is
 * the caller's own already-built `<input ...>` tag, dropped in verbatim.
 * `inputId` is the id that tag carries — the ghost and status elements are
 * addressed off it (`${inputId}-pc-ghost`, `${inputId}-pc-status`) so the
 * caller can `getElementById` them right after inserting this markup, before
 * constructing `createPillComplete`.
 *
 * Runs once at page-render time (module- or server-side), the same role
 * `shareOverlayHtml` plays in share-overlay-viz.mjs — it is NOT one of the
 * three functions an adopting page splices into its inline script, so it is
 * the one export in this module allowed to import `escapeHtml`.
 */
export function pillCompleteMarkup({ inputId, inputHtml }) {
  const esc = escapeHtml;
  const id = esc(String(inputId == null ? "" : inputId));
  return `<div class="pc-field">
      ${inputHtml}
      <span class="pc-ghost" id="${id}-pc-ghost" aria-hidden="true"></span>
    </div>
    <p class="pc-status" id="${id}-pc-status" aria-live="polite"></p>`;
}

/**
 * The browser controller. `getCandidates` is a closure the caller supplies
 * that returns the CURRENT pills (already through pillCandidates, or raw —
 * this calls pillCandidates on the result itself); it is invoked fresh on
 * every recompute, never cached here, which is what keeps a completion from
 * ever outliving the pill that grounded it.
 *
 * Keyboard contract:
 *   - any `input` event recomputes and repaints, no debounce;
 *   - Tab accepts `top.command` (never the typed text plus a suffix), moves
 *     the caret to the end, clears the ghost, keeps focus; it never submits.
 *     `preventDefault` fires ONLY when a candidate is actually showing, so a
 *     keyboard user is never trapped on an empty match;
 *   - ArrowRight accepts the same way, but only when the caret already sits
 *     at the end of the input AND a tier-1 ghost is showing — otherwise it
 *     moves the caret like it always does;
 *   - ArrowDown/ArrowUp move a highlighted index through the rail, wrapping,
 *     for a keyboard/screen-reader user browsing the options; they do not
 *     change what Tab or ArrowRight accept (that is always `top`, the same
 *     candidate the inline ghost already promised);
 *   - Enter does nothing here on purpose — the page's own submit handler
 *     reads whatever is literally in the box. Filling and submitting are two
 *     separate, deliberate gestures, never one;
 *   - Escape dismisses the ghost/rail-highlight/status text until the value
 *     next changes (the next `input` event un-dismisses);
 *   - anything happening while `event.isComposing` is skipped entirely, and
 *     a recompute runs on `compositionend` instead.
 *
 * The input's value is only ever written by a deliberate Tab/ArrowRight
 * accept — never by typing, never by a browser-style "insert and select"
 * trick, because that would put text in the box nobody typed and a
 * following Enter would submit words the user never wrote.
 *
 * `railEl` is the page's own existing pill rail, promoted to the combobox
 * popup rather than adding a second surface: this sets `role="listbox"` on
 * it and looks up each pill's DOM node by its own `data-command` attribute
 * (the attribute mud-viz.mjs's `renderChatPills` already stamps on every
 * pill button) to toggle `aria-selected`/a `.pc-active` class and drive
 * `aria-activedescendant` on the input. A page whose pills don't carry
 * `data-command` yet still gets full keyboard completion; it only misses the
 * DOM-level highlight/activedescendant wiring until its own pill markup adds
 * that attribute.
 *
 * Self-contained, `.toString()`-splice-safe: no outer refs. Calls
 * `pillCandidates` and `matchPills` by bare name — splice those two
 * alongside this one, under these exact names, in the same inline script.
 *
 * Returns `{ refresh, destroy }`. `refresh` recomputes and repaints against
 * the CURRENT input value and CURRENT candidates — call it from the page's
 * own render pass whenever the pill set changes for a reason other than
 * typing (the player moved rooms, an object was taken), so the ghost and
 * rail never lag behind what is actually grounded right now. `destroy`
 * removes every listener this attached.
 */
export function createPillComplete({ input, ghostEl, statusEl, railEl, getCandidates, onAccept }) {
  let state = { matches: [], top: null, ghost: "", tier: null };
  let activeIndex = 0;
  let dismissed = false;

  function pillNodeFor(command) {
    if (!railEl) return null;
    const nodes = railEl.querySelectorAll("[data-command]");
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-command") === command) return nodes[i];
    }
    return null;
  }

  function clearHighlights() {
    if (!railEl) return;
    const nodes = railEl.querySelectorAll("[data-command]");
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].removeAttribute("aria-selected");
      nodes[i].classList.remove("pc-active");
    }
  }

  function syncGhostScroll() {
    if (ghostEl) ghostEl.scrollLeft = input.scrollLeft;
  }

  function syncGhostBox() {
    if (!ghostEl || !window.getComputedStyle) return;
    const style = window.getComputedStyle(input);
    const props = [
      "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "textIndent",
    ];
    for (let i = 0; i < props.length; i++) ghostEl.style[props[i]] = style[props[i]];
    syncGhostScroll();
  }

  function paint() {
    if (railEl) railEl.setAttribute("role", "listbox");
    if (statusEl) statusEl.setAttribute("aria-live", "polite");
    if (ghostEl) ghostEl.setAttribute("aria-hidden", "true");

    if (dismissed || !state.matches.length) {
      if (ghostEl) ghostEl.textContent = "";
      if (statusEl) statusEl.textContent = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      clearHighlights();
      return;
    }

    input.setAttribute("aria-expanded", "true");
    if (ghostEl) {
      ghostEl.textContent = "";
      if (state.tier === 1 && state.ghost) {
        const typedPart = document.createElement("span");
        typedPart.className = "pc-ghost-typed";
        typedPart.textContent = input.value;
        const suffixPart = document.createElement("span");
        suffixPart.className = "pc-ghost-suffix";
        suffixPart.textContent = state.ghost;
        ghostEl.appendChild(typedPart);
        ghostEl.appendChild(suffixPart);
      }
      syncGhostScroll();
    }
    if (statusEl) {
      statusEl.textContent = (state.tier === 2 && state.top) ? (state.top.label + " — press tab to fill in") : "";
    }

    clearHighlights();
    const active = state.matches[activeIndex] || state.top;
    const node = active ? pillNodeFor(active.command) : null;
    if (node) {
      node.setAttribute("aria-selected", "true");
      node.classList.add("pc-active");
      if (node.id) input.setAttribute("aria-activedescendant", node.id);
      else input.removeAttribute("aria-activedescendant");
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function recompute() {
    const raw = getCandidates ? getCandidates() : [];
    const candidates = pillCandidates(raw);
    state = matchPills(candidates, input.value);
    activeIndex = 0;
    paint();
  }

  function acceptTop() {
    if (!state.top) return;
    const accepted = state.top;
    input.value = accepted.command;
    input.setSelectionRange(input.value.length, input.value.length);
    dismissed = false;
    if (onAccept) onAccept(accepted);
    recompute();
  }

  function onKeyDown(e) {
    if (e.isComposing) return;
    if (e.key === "Tab") {
      if (!dismissed && state.matches.length && state.top) {
        e.preventDefault();
        acceptTop();
      }
      return;
    }
    if (e.key === "ArrowRight") {
      const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      if (!dismissed && atEnd && state.tier === 1 && state.ghost) {
        e.preventDefault();
        acceptTop();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (dismissed || !state.matches.length) return;
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + delta + state.matches.length) % state.matches.length;
      paint();
      return;
    }
    if (e.key === "Escape") {
      dismissed = true;
      paint();
      return;
    }
  }

  function onInput(e) {
    if (e.isComposing) return;
    dismissed = false;
    recompute();
  }

  function onCompositionEnd() {
    recompute();
  }

  function onScroll() {
    syncGhostScroll();
  }

  function onResize() {
    syncGhostBox();
  }

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "both");
  if (railEl && railEl.id) input.setAttribute("aria-controls", railEl.id);
  input.setAttribute("aria-expanded", "false");

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("input", onInput);
  input.addEventListener("compositionend", onCompositionEnd);
  input.addEventListener("scroll", onScroll);
  window.addEventListener("resize", onResize);

  syncGhostBox();
  recompute();

  return {
    refresh: recompute,
    destroy: function () {
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("input", onInput);
      input.removeEventListener("compositionend", onCompositionEnd);
      input.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    },
  };
}

/**
 * Geometry and layering only — never the input's own font or text colour,
 * which are copied at runtime from its computed style (see createPillComplete's
 * `syncGhostBox`) so a page's own typography is honoured with zero
 * page-specific CSS here. `background: transparent` on the real `<input>` is
 * the one exception: it is structural, not a themed colour choice — the
 * ghost text sits in a layer BEHIND the input, so the input has to be
 * see-through for the ghost's suffix to read at all. Themed through `--pc-*`
 * custom properties defaulting to the site's shared tokens, the way
 * share-overlay-viz.mjs's `--so-*` variables do.
 */
export const PILL_COMPLETE_CSS = `
  .pc-field {
    --pc-ghost-color: var(--muted, #6E7168);
    --pc-highlight: var(--corpus-soft, rgba(90, 128, 172, .12));
    --pc-highlight-line: var(--corpus, #5A80AC);
    position: relative;
    display: block;
  }
  .pc-field > input {
    position: relative;
    z-index: 1;
    background: transparent;
  }
  .pc-ghost {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: pre;
    pointer-events: none;
    box-sizing: border-box;
  }
  .pc-ghost-typed { color: transparent; }
  .pc-ghost-suffix { color: var(--pc-ghost-color); }
  .pc-status {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
  .pc-active {
    background: var(--pc-highlight);
    outline: 2px solid var(--pc-highlight-line);
    outline-offset: -2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .pc-ghost, .pc-active { transition: none !important; }
  }
`;
