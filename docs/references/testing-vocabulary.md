# The testing vocabulary — what the terms mean, and who says so

**Consumer in repo:** `CLAUDE.md`'s "Test the blast radius" section, `package.json`'s `test:*`
scripts, `test/**`, `archive/PLAN_NORMATIVE.md` §9.5.
**Retrieval date:** 2026-07-17.
**Licence:** link + brief factual excerpt, except where noted — **SEVOCAB definitions are free to
quote with attribution** (see below), and are quoted here on that basis.

## Where the authority actually is

There is no single authority, and the disagreement is structural rather than sloppy.

| body | current version | what it defines |
|---|---|---|
| **ISTQB Glossary** | **application v4.7.2, 2026-05-30**. **Content is no longer versioned** — continuous since Feb 2023 | test *levels*. 651 English terms, each with its own integer version |
| **ISO/IEC/IEEE 24765:2017** (2nd ed.) | supersedes 24765:2010 and **IEEE 610.12-1990** | general SE vocabulary. A 3rd edition is in committee draft |
| **ISO/IEC/IEEE 29119-1:2022** | current | **the governing standard for testing vocabulary.** Regression testing, test suite and test case all resolve here, not to 24765 |

**Cite ISTQB as "application v4.7.2 (2026-05-30)" and say it is the *application* version.** The
content has no version number. Individual terms do — cite those.

**SEVOCAB is free to quote.** The IEEE/ISO definitions are paywalled in the standards themselves but
published at http://sevocab.computer.org/. Its own notice: "In accordance with ISO/IEC JTC 1/SC 7
N2882 and N2930, this definition is made publicly available. Permission is granted to copy the
definition providing that its source is cited." IEEE's parallel notice requires
"Copyright ©, 2026, IEEE. Used by permission." to travel with the definition.

## The finding: ISTQB split "unit" from "component" testing in 2025

Nearly every secondary source still says they are synonyms. **They are not, as of 2025-08-12.**

| term | ISTQB, verbatim (read 2026-07-17) |
|---|---|
| **component testing** | "A test level that focuses on individual hardware or software components." Synonym: *module testing* only |
| **unit testing** | "A test level that focuses on evaluating the smallest part of code testable in isolation." No synonyms |
| **integration testing** | "A test level that focuses on interactions between components or systems." |
| **regression testing** | "A type of change-related testing to detect whether defects have been introduced or uncovered in unchanged areas of the software." |
| **smoke testing** | "A test type to gain sufficient confidence that a test object is ready for planned testing." |
| **test harness** | "A collection of drivers and test doubles needed to execute a test suite." |
| **test fixture** | "The predefined data and test environment to test software in a repeatable manner." |
| **sanity testing**, **flaky test** | **not defined** |

The term history dates it exactly: `component-testing` changed 2025-08-12 with the message "Remove
unit testing as a synonym of component testing", and `unit-testing` was created 2026-04-18. Anything
published before August 2025 that equates them is out of date.

`ISO/IEC/IEEE 29119-1:2022` §3.64 on regression testing adds the discriminator most often muddled:
it "differs from **retesting** in that it does not test that the modification works correctly, but
that other parts of the system have not been accidentally affected by the change."

**24765:2017 does not define "unit testing" at all.** SEVOCAB's "unit test" entries come from
ISO/IEC 2382:2015 and ISO/IEC TR 7052:2023.

## "Unit" is a size and a convention, not a boundary

Fowler, "UnitTest" (https://martinfowler.com/bliki/UnitTest.html, published 2014-05-05, updated
2017-03-09) calls unit testing "very ill-defined" and recounts a trainer covering "24 different
definitions of unit test" in one morning.

His distinction, and the one that carries information:

- **Solitary** — dependencies are replaced with test doubles, so a fault in a collaborator cannot
  fail this test.
- **Sociable** — real collaborators are used where communication is not awkward.

The vocabulary is **Jay Fields's** (*Working Effectively with Unit Tests*); the 2017-03-09 update is
Fowler adopting it, which is why the terms are absent from the 2014 original.

Empirical support that the label does not track the practice: **Trautsch & Grabowski, "Are There Any
Unit Tests? An Empirical Study on Unit Testing in Open Source Python Projects", ICST 2017,
pp. 207–218, DOI 10.1109/ICST.2017.26.** *Title and DOI verified; the abstract is paywalled and was
not read.*

**The honest formulation: state the boundary you mean — solitary or sociable, in-process or
out-of-process — rather than relying on the word "unit".**

## The test doubles — Meszaros's taxonomy

**Gerard Meszaros, *xUnit Test Patterns: Refactoring Test Code*, Addison-Wesley Professional,
2007-05-21. ISBN-13 978-0-13-149505-0.** Addison-Wesley Signature Series (Fowler). Companion site
http://xunitpatterns.com/ — **HTTP only; its TLS port refuses connections.**

| pattern | book p. | Meszaros, verbatim |
|---|--:|---|
| **Test Double** (umbrella) | 522 | "We replace a component on which the SUT depends with a **'test-specific equivalent.'**" |
| **Test Stub** | 529 | "…a test-specific object that **feeds the desired indirect inputs into** the SUT." A **control point** |
| **Test Spy** | 538 | "…**capture the indirect output calls** … **for later verification by the test**." An **observation point** |
| **Mock Object** | 544 | "…**verifies it is being used correctly by the SUT**." Asserts **during** execution — "The test need not do any assertions at all!" |
| **Fake Object** | 551 | "…a **much lighter-weight implementation**." |
| **Dummy Object** | 728 | "…an object that **has no implementation**." Filed under *Value Patterns* |

The discriminators, in his words:

- Spy vs Stub: "the Test Spy is **'just a' Test Stub with some recording capability**."
- Spy vs Mock: a Spy's assertions run "**after** the SUT has been exercised"; a Mock's run during.
  And "**a Mock Object is a lot more than just a Test Stub plus assertions; it is used a
  fundamentally different way.**"
- Fake vs Stub: "while a Test Stub acts as a control point to inject indirect inputs into the SUT
  **the Fake Object does not**." A Fake is **self-consistent across calls** — values passed in
  earlier come back later — where Stubs and Mocks are "hard-coded or configured by the test". That
  self-consistency is the real discriminator, sharper than "lightweight".

Two things to know before quoting the site:

- **Meszaros says a Dummy is arguably not a Test Double**: "a Dummy Object **isn't really a Test
  Double per se** but rather an alternative to the value patterns."
- **The site's "Also known as" fields are unreliable** — the Dummy page lists "Stub" as an alias and
  the Fake page lists "Dummy". Pre-publication naming artifacts. Cite the definitions, not the
  aliases.

**"Test Harness" is not a Meszaros term.** The string does not appear in his glossary or pattern set.
His pattern is **Test Automation Framework** (p. 298). "Test harness" is IEEE/ISO's —
**ISO/IEC/IEEE 24765:2017**: "scaffolding code written for the purpose of exercising lower-level code
when the higher-level code that will ultimately exercise it is not yet available."

**"Test fixture" is ambiguous and Meszaros says so**, on a dedicated disambiguation page: generic
xUnit means "the preconditions of the test"; NUnit means the Testcase Class; Fit means the Adapter.
His own convention is the first.

Fowler's **"Mocks Aren't Stubs"** (published 2004-07-08, revised 2007-01-02) credits Meszaros's
vocabulary explicitly and adds two orthogonal dichotomies: **state vs behaviour verification**, and
**classical vs mockist TDD**.

The word itself predates both: **Mackinnon, Freeman & Craig, "Endo-Testing: Unit Testing with Mock
Objects", XP2000**, published in Succi & Marchesi (eds.), *Extreme Programming Examined*,
Addison-Wesley, 2001. It opens with the Mock Turtle from *Alice in Wonderland*.

## Smoke testing — electronics, not plumbing

**The Jargon File is the lexicographic authority and it makes a direct etymological claim.**
`http://catb.org/jargon/html/S/smoke-test.html` — *the site's TLS certificate is broken; use plain
HTTP.* Verbatim:

> **smoke test**: n. **1.** A rudimentary form of testing applied to **electronic equipment following
> repair or reconfiguration, in which power is applied and the tester checks for sparks, smoke, or
> other dramatic signs of fundamental failure.** … **2. By extension, the first run of a piece of
> software after construction or a critical change.**

Two things settle it: the software sense is marked "**By extension**" from the electronics sense, and
**the file mentions no plumbing at all** — its only analogue is typography, hedged as a
"semi-parallel". Print form: Raymond (comp.), *The New Hacker's Dictionary*, 3rd ed., MIT Press,
1996, ISBN 0262680920.

**The plumbing derivation is folk etymology.** The plumbing practice is real and older (~1875), but
no primary source derives the *software* term from it. Two obvious metaphors, coined independently.

**The definition is McConnell's:** "Daily Build and Smoke Test", *IEEE Software* **13**(4), July
1996, **pp. 144, 143** — *not a typo: it is a back-page column that starts on 144 and continues
backwards onto 143.* **DOI 10.1109/MS.1996.10017** — *the widely-circulated `10.1109/52.526831`
is wrong; it resolves to a different paper in the same issue.* Verbatim:

> "**Smoke test daily.** The smoke test should **exercise the entire system from end to end. It does
> not have to be exhaustive, but it should be capable of exposing major problems.** The smoke test
> should be thorough enough that **if the build passes, you can assume that it is stable enough to be
> tested more thoroughly.**"

That last clause is the point to keep: **a smoke test decides whether deeper testing is worth starting.**
Also McConnell, *Rapid Development*, Microsoft Press, 1996, ISBN 9781556159008, Ch. 18; and *Code
Complete*, 2nd ed., Microsoft Press, 2004, §29.4, p. 702.

**The smoke/sanity distinction is folklore.** ISTQB never distinguished them — it made *sanity test*
a **synonym** of *smoke test* from v1.2 (2006) through v3.1, then dropped the term entirely.
IEEE/ISO defines neither (SEVOCAB returns 0 for both). The tidy "smoke = broad and shallow, sanity =
narrow and deep" table has nothing behind it.

## The pyramid, and its lack of evidence

**Mike Cohn, *Succeeding with Agile: Software Development Using Scrum*, Addison-Wesley Professional,
2009-10-26, ISBN 978-0-321-57936-2.** He called it the **Test Automation Pyramid**.

Fowler's "TestPyramid" (2012-05-01) has the best provenance anywhere: Cohn "originally drew it **in
conversation with Lisa Crispin in 2003-4** and described it **at a scrum gathering in 2004**. **Jason
Huggins independently came up with the same idea around 2006.**" Fowler's own caveat calls it an
assumption: "The pyramid is based on the **assumption** that broad-stack tests are expensive, slow,
and brittle compared to more focused tests… While this is usually true, **there are exceptions**."

A standards body now defines it — **ISO/IEC 33202:2024 §3.26**: "graduated series of tests, which
includes many simple and automated tests (unit tests) with less frequent integration tests and few
lengthy end-to-end or manual tests". *Copyright © 2026 ISO/IEC, made publicly available per ISO/IEC
JTC 1/SC 7 N2882 and N2930; source cited per that permission.*

**The pyramid has no empirical validation, on either side.** Cohn cites no study. Across arXiv,
Crossref and DBLP, no study tests whether the prescribed shape improves fault detection, defect
escape rate or maintenance cost — everything found presupposes it and then applies or reframes it.
The counter-literature (Dodds's testing trophy, 2019; Spotify's honeycomb, Schaffer & Dybeck, 2018)
is equally evidence-free, arguing from ROI and architecture. The provenance chain is whiteboard
sketch → conference talk → book chapter → bliki, and nobody cites data at any link.

## "Blast radius" is an ops metaphor, and this repo uses it for something else

**`CLAUDE.md` has a section titled "Test the blast radius, not the whole suite", meaning *the set of
tests a change can reach*. No source supports that sense.**

Every attested use — SRE, AWS, Azure, chaos engineering — is about **damage from a failure or
deployment in production**. The term is informal and has never been formally defined:

| source | occurrences of "blast radius" |
|---|--:|
| *Site Reliability Engineering* (O'Reilly, 2016) | **0** — all 43 chapters grepped |
| *The Site Reliability Workbook* (2018) | 2, both in Ch. 10, both undefined |
| AWS Security Pillar | **0** — contradicts the common claim that it defines the term |
| NIST CSRC glossary | no entry |
| DBLP, on testing | **0** |

Where formal writing needs the concept it uses a different phrase: AWS's whitepaper is "Reducing the
**Scope of Impact** with Cell-Based Architecture". Even the foundational chaos-engineering paper
(Basiri et al., *IEEE Software* 33(3), 2016) does not use it — it says "reduce the scope of the
experiment to a subset of users".

**The literature's term for what `CLAUDE.md` describes is Regression Test Selection**, and it is a
30-year field with a formal *safety* property and empirical evaluation:

- **Yoo, S., & Harman, M. (2012), "Regression testing minimization, selection and prioritization: a
  survey", *Software Testing, Verification and Reliability* **22**(2), pp. 67–120,
  DOI 10.1002/stvr.430.** *Note: issue 2, not 9 — a widely-copied error.*
- Rothermel & Harrold (1996), "Analyzing regression test selection techniques", *IEEE TSE* 22(8),
  pp. 529–551, DOI 10.1109/32.536955.
- Rothermel & Harrold (1997), "A safe, efficient regression test selection technique", *ACM TOSEM*
  6(2), pp. 173–210, DOI 10.1145/248233.248262.

DBLP: "blast radius" 2 hits, neither about testing. "regression test selection", 224.

The sharpest detail: **Google's own SRE book describes tmct's exact practice and never reaches for
the metaphor** — Ch. 17: "When a change is made to a file, Bazel only rebuilds the part of the
software that depends on that file… Instead of running all tests at every submit, **tests only run
for changed code**."

The metaphor reads naturally and is not wrong. It is an extension of an ops term into testing, and
no source backs that sense. Worth knowing before it reaches anything public-facing.

## "Lane" is a coinage

Not in ISTQB's 651 terms, not in SEVOCAB, not in Meszaros. The nearest sources are **fastlane**
(Krause, 2014) — which uses `lane` for a named sequence of build actions and **never defines the
word**, only shows examples — and the older **swimlane** metaphor from BPMN/UML activity diagrams.
CI systems don't use it: Jenkins has stages, GitLab has stages and jobs, GitHub Actions has jobs.

**The standardised term is "test suite"** — ISO/IEC/IEEE 29119-1:2022 §3.129: "set of test cases or
test procedures", with the note "Grouping into a test suite is typically based on **when tests are
executed**." That note describes tmct's tiers exactly.

"Lane" reads fine and needs no apology. It is not standard and should not be presented as though it
were.

**"Test corpus"** is borrowed from linguistics, where "corpus" is standard for a curated body of
language data. For a project built on wink-nlp and committed language corpuses, the borrowing is apt
and self-explanatory.

## Other terms

- **Flaky test** — no authoritative definition exists. Not in ISTQB, not in SEVOCAB. The de facto
  reference: **Luo, Q., Hariri, F., Eloussi, L., & Marinov, D. (2014), "An empirical analysis of
  flaky tests", *FSE 2014*, pp. 643–653, DOI 10.1145/2635868.2635920.** Meszaros's **Erratic Test**
  (p. 228) — "sometimes they pass and sometimes they fail" — is the same concept, seven years
  earlier.
- **Property-based testing** — **Claessen, K., & Hughes, J. (2000), "QuickCheck: a lightweight tool
  for random testing of Haskell programs", *ICFP 2000*, pp. 268–279, DOI 10.1145/351240.351266.**
  Also in *SIGPLAN Notices* 35(9), same pages, DOI 10.1145/357766.351266 — same paper, two DOIs.
- **Mutation testing** — **DeMillo, R. A., Lipton, R. J., & Sayward, F. G. (1978), "Hints on Test
  Data Selection: Help for the Practicing Programmer", *Computer* 11(4), pp. 34–41,
  DOI 10.1109/C-M.1978.218136.** Introduces mutation analysis and the coupling effect.

## Verified-source caveats

- Meszaros page numbers come from the companion site's own "see page N" pointers, not the book.
- McConnell's DOI is not in Crossref (IEEE never deposited the column); it rests on OpenAlex plus
  doi.org resolution. *Rapid Development* Ch. 18 rests on McConnell's own cross-reference in *Code
  Complete 2*, not the book's TOC.
- The exact ISTQB version that removed "sanity test" is bounded but not pinned: present in v3.1,
  absent now, and not removed in v3.3–v3.6. Anyone citing a specific removal version is inferring.
- "Blast radius" earliest attested software use found: 2011-08-17, on Hacker News, **in scare
  quotes**. One corpus, so treat as a floor rather than a proven first.
- Trautsch & Grabowski's abstract is paywalled; title and DOI verified only.
- The plumbing smoke-test dating (Buchan 1891, Stevenson 1892) is via Wikipedia's citations.
