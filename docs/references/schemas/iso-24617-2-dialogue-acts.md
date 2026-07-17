# ISO 24617-2 — the dialogue act standard

**Canonical source:** ISO 24617-2:2020, *Language resource management — Semantic annotation
framework (SemAF) — Part 2: Dialogue acts*, **Edition 2, published 2020-12-02**, status current.
https://www.iso.org/standard/76443.html · ICS 01.020 · committee ISO/TC 37/SC 4/WG 2.
It supersedes ISO 24617-2:2012 (Edition 1).
**Licence:** the standard is paywalled and is **not** committed here, quoted from, or reproduced.
The material below comes from two openly-licensed sources that describe it.
**Retrieval date:** 2026-07-17.
**Consumer in repo:** none yet — this is a naming decision taken before anything is built. See
`PLAN_NORMATIVE.md` §4.5.

## Sources actually read

The published text was not obtained. `iso.org` returns 403 to automated fetches, and the standard
was not purchased. Everything below comes from:

- **Bunt, Petukhova, Gilmartin, Pelachaud, Fang, Keizer, Prévot (2020).** "The ISO Standard for
  Dialogue Act Annotation, Second Edition." *LREC 2020*, Marseille, pp. 549–558. ELRA, **CC-BY-NC**.
  https://aclanthology.org/2020.lrec-1.69.pdf
- **ISO/DIS 24617-2, Second Edition — Draft International Standard, dated 2019-09-05**, posted
  publicly by the standard's own editor, Harry Bunt, at https://dit.uvt.nl/ — a **draft**, not the
  published text.

The edition number, publication date, status, ICS and committee come from the EVS (Estonian
standards body) catalogue entry plus the draft's cover page.

**Treat this entry as a good-faith reading of a draft plus a peer-reviewed paper by the editors, not
as a citation of ISO 24617-2:2020 itself.** The taxonomy, dimensions, counts and Annex F definitions
are consistent across both sources, so drift from the published text is unlikely. It is not
excluded. A claim in tmct that rests on the exact published wording needs the published text.

## Why tmct reads this

The conversational lanes classify what a visitor is doing — asking, teaching, greeting, correcting.
tmct has **no intent vocabulary at all** (`CAPABILITIES_2.0.3.md` row 139, `absent`). So this is
the rare case where a standard can be adopted before the code exists, instead of reconciled after.

## The ten dimensions

**The second edition has ten, not the nine of the 2012 edition.** `/contactManagement/` is new.
Data-category names are camelCase between slashes (Annex F, normative).

| # | data category | definition |
|---|---|---|
| 1 | `/task/` | dialogue acts whose performance contributes to pursuing the task or activity that motivates the dialogue |
| 2 | `/autoFeedback/` | the sender discusses or reports on **his own** processing of previous contributions |
| 3 | `/alloFeedback/` | the sender discusses the **addressee's** processing of previous contributions |
| 4 | `/turnManagement/` | regulating the allocation of the speaker role |
| 5 | `/timeManagement/` | allocating time to the participant occupying the speaker role |
| 6 | `/discourseStructuring/` | explicitly structuring the interaction |
| 7 | `/ownCommunicationManagement/` | the speaker edits his own speech within the current turn |
| 8 | `/partnerCommunicationManagement/` | a non-speaker edits the current speaker's speech |
| 9 | `/socialObligationsManagement/` | greeting, thanking, apologising |
| 10 | `/contactManagement/` | establishing or ensuring contact with other participants (**new in Ed. 2**) |

A dimension is admitted on three criteria: empirical validity, orthogonality, recognisability.

## General-purpose communicative functions

```
General-purpose functions
├── Information-transfer functions
│   ├── Information-seeking
│   │   └── Question
│   │       ├── Propositional Question ── Check Question
│   │       ├── Set Question ─────────── Test Question
│   │       └── Choice Question
│   └── Information-providing
│       └── Inform
│           ├── Answer ──── Disconfirm | Confirm
│           ├── Agreement
│           └── Disagreement ── Correction
└── Action-discussion functions
    ├── Commissives
    │   ├── Offer
    │   ├── Promise
    │   ├── Address Request ─── Decline Request | Accept Request
    │   └── Address Suggestion ─ Accept Suggestion | Decline Suggestion
    └── Directives
        ├── Suggestion
        └── Request ── Instruct ── Address Offer ── Decline Offer | Accept Offer
```

Counts: 6 information-seeking, 7 information-providing, 8 commissive, 6 directive — **27 general
purpose functions**. Dimension-specific functions add 36 more, across every dimension except
`/task/`, which has none (domain-specific functions plug in via Annex E).

**Two traps for an implementation, both stated in the standard:**

- **Accepting a request or a suggestion is a *commissive*. Accepting an offer is a *directive*.**
  The Accept/Decline pairs do not sit under the parent you would expect.
- `Address Request` / `Address Offer` / `Address Suggestion` are the general "dealing with" nodes;
  Accept and Decline are their special cases.

**Semantic connectedness rule.** Within a dimension, any two functions are either mutually exclusive
or one specialises the other. So the annotator picks **the most specific function the evidence
supports**. The worked example: for "A: And that's the first flight tomorrow, right? / B: That's
right", the answer is `Confirm` — not `Inform`, `Agreement` or `Answer`.

**Responsive functions** carry a functional-dependence relation to an antecedent: Answer, Confirm,
Disconfirm, Correction, Agreement, Disagreement, and the nine Accept/Decline/Address functions.

## What tmct would map onto this

Nothing yet. The lanes are the obvious consumers, and the mapping is worth writing down before an
intent vocabulary gets coined ad hoc:

| tmct behaviour | ISO 24617-2 function | dimension |
|---|---|---|
| "what does X import?" | `Set Question` | `/task/` |
| "does X import Y?" | `Propositional Question` | `/task/` |
| "remember that fire causes smoke" | `Inform` | `/task/` |
| an answer from the graph | `Answer` | `/task/` |
| the honest-miss reply | `Disconfirm`, or feedback-dimension negative auto-feedback | `/task/` or `/autoFeedback/` |
| "hi" / "thanks" | `Initial Greeting` / `Thanking` | `/socialObligationsManagement/` |
| "no, I meant Y" | `Correction` | `/task/` |

The honest-miss row is the interesting one. tmct's miss is a claim about tmct's **own processing**
("I could not resolve that term"), which is what `/autoFeedback/` is for — not a `/task/` answer at
all. If an intent vocabulary is ever built, that distinction is already load-bearing in the product
and the standard already has a name for it.

`MISS_REASONS` is a closed 4-term set (`UNRESOLVED_TERM`, `CAPABILITY_ABSENT`, `TRUNCATED_GRAPH`,
`NO_SOURCE`). Those are reasons, not dialogue acts, and the standard does not carry them. They stay
tmct's.

## Deepen-next

- **Buy or borrow ISO 24617-2:2020** before any public claim rests on it. Everything here is a
  draft reading.
- **DiAML** is the standard's markup language, and **DialogBank** (https://dialogbank.uvt.nl/)
  publishes corpora annotated to it. If tmct ever wants a benchmark for intent classification, that
  is where a reference annotation already exists.
- ISO 24617-8 (DR-core) supplies the 19 rhetorical relations Ed. 2 imports. Relevant only if tmct
  models discourse structure rather than single turns.
