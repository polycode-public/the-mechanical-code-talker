# Graded language-comprehension measures — the chatbench difficulty spectrum

Sources for calibrating chatbench cases on a recognized too-easy → tough-but-solvable →
too-hard spectrum, from child development to academic (case-set v2).
All entries authored offline 2026-07-04 — retrieval dates/URLs UNVERIFIED-pending-web-check;
none of these instruments' items may be committed (most are commercially licensed tests —
we borrow their *structure*, never their content).

| Measure | What it is | Band it anchors | Licence note |
|---|---|---|---|
| TROG-2 (Bishop) | Receptive-grammar test, ages 4+, blocks of grammatical constructions in increasing difficulty incl. pronoun binding, reversible clauses, relatives | child → tough-but-solvable; the construction-block taxonomy is our tag scheme | Commercial (Pearson) — structure only |
| CELF-5 | Clinical language fundamentals, ages 5–21; following directions, sentence comprehension; age-norm tables | child bands | Commercial — structure only |
| C. Chomsky 1969, *The Acquisition of Syntax in Children from 5 to 10* | Which constructions are acquired late (ask/promise, pronominalization) | tough-but-solvable item source | Academic monograph — cite, don't copy |
| CHILDES (MacWhinney) | Open child-language corpus | naturalistic easy-band inputs | Open (TalkBank) — usable data |
| bAbI (Facebook AI 2015, arXiv:1502.05698) | 20 graded toy QA task families | REJECTED as backbone (operator decision 2026-07-04): tests expected-AI mechanics, not human language standards — same overfitting failure mode as self-authored cases; kept here only as a what-not-to-do reference | Open — not used |
| CoQA / QuAC | Conversational QA with cross-turn coreference | academic multi-turn | Open datasets — verify licences |
| CLUTRR | Systematic reasoning over kinship graphs | graph-traversal analog | Open — verify |
| CEFR (A1–C2) | Language-proficiency banding framework | the band labels on every case | Open framework (Council of Europe) |
| IRT (item response theory) | Psychometric difficulty-placement method | maintenance methodology; pragmatic stand-in: per-cycle pass-rate bands | Method, not data |

Backbone decision: CEFR bands x TROG/CELF construction blocks (original items only).
Consumer in repo: `test-benchmarks/chatbench/cases.jsonl` graded tags (case-set v2), `test/showcase.test.mjs`
promotion rule (100% for two cycles → retained showcase; 0% → ceiling marker, not failure).
