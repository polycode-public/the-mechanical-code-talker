// memory/fact-order.mjs — the order a fact listing falls back to once ranking
// runs out of things to say. Every rank over fact rows (bias, trust, relevance)
// ends in ties, and a stable sort settles a tie by array index, which is
// arrival order: two peers holding one fact set then render the same facts on
// different lines.
//
// The tiebreak here is a pure function of the fact's own content — the same
// (subject, predicate, object) triple hash.mjs content-addresses a Fact by,
// plus the provenance that separates two sources asserting one triple. NUL
// delimits the parts for hash.mjs's reason: it never occurs inside a
// normalized term or predicate, so "a b|c" and "a|b c" cannot collide on one
// key. Codepoint order throughout, never localeCompare — two locales have to
// land on the same order.
//
// The store's own precedent is rows.mjs's sortFactIndividualsById, which sorts
// Fact individuals by content-addressed id after every merge for exactly this
// reason. This is that discipline carried through to the read side.

/** A fact row's content-derived sort key. */
export const factOrderKey = (f) => [
  f?.subject ?? "", f?.predicate ?? "", f?.object ?? "", f?.provenance ?? "",
].join("\0");

/** Order two fact rows by content. The last comparison in any fact ranking. */
export function compareFactsByContent(a, b) {
  const ka = factOrderKey(a);
  const kb = factOrderKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
