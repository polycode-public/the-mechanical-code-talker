# PLAN_HISTORICAL_CITY.md — a real city, grounded in history, explored like an adventure

Status: RESEARCH / DESIGN — not started. Origin: an operator idea, 2026-07-25. Nothing in this
document is live code.

## The idea, in one paragraph

Take a city with deep historical records — Amsterdam is the working example — and build a
temporal graph of it: buildings, streets, shops, residents, objects, grounded in a historical
ontology and tuned so a fact surveyed at one date carries forward until a later record
contradicts it. Walk that graph the way `adventure.html` already walks a fixed small world: rooms
to enter, objects to take, people to talk to. Where the record runs out — a level of detail no
survey captured — fill it in from census-plausible options, generate it once, and make it durable
from then on. Objects respawn or don't depending on what they are: street litter comes back
overnight, a shop's stock restocks, a unique stolen artwork stays gone. NPCs remember what a
player tells them and answer what they're asked. When a player next observes an NPC, that NPC's
story is caught up to the present — including the times they weren't where they were last seen.
The world persists across sessions and players, the way `PLAN_MUD.md` already designs for. The
default entry point is outside 32 Oudezijds Voorburgwal, right now, in real time.

## What this grounds in — real, shipped tmct capability

Nothing here starts from zero. Four subsystems already do most of the mechanical work this idea
needs; the design below is mostly about composing them, not inventing new primitives underneath.

- **The adventure engine** (`src/services/adventure.mjs`). Rooms, objects, NPCs, and take/drop
  already exist, and — critically for this plan — **world state is already plain fact rows**:
  `foldWorldState(factRows)` folds the graph's own facts into room/object/NPC state,
  `worldActionRows(rows)` reads world actions the same way. There is no bespoke "game format" to
  design around; a historical-city graph and an adventure world are the same representation
  already. `currentPosition`, `roomAffordances`, `objectLookProperties`, `objectClassChain`,
  `personKnowledgeLines`, and `personRoomReport` are the exact primitives this plan's NPC-memory
  and object-state work would extend, not replace. Discourse binding for `it`/`them`/`him`/`her`
  (`bindPronouns`, `registerReferent`) shipped this session (`PLAN_DISCOURSE_AND_RECOGNITION.md`
  Part A) and already threads through `adventureTurn` — a player exploring a city block and
  saying "who lives there" or "pick that up" already has a real mechanism underneath it.
- **`PLAN_MUD.md`.** Persistence for a shared world over a `server:<name>` memory backend is
  already designed there (six rounds of the operator's own framing converged on a
  DynamoDB-shaped table per server, an anonymous-tier TTL, IAM Identity Center for private
  servers). This plan does not redesign persistence — it depends on `PLAN_MUD.md` shipping first,
  and names one real divergence from it below (§5).
- **Wikipedia ingestion.** `src/adapters/corpus/wikipedia-live.mjs` already speaks to
  `SIMPLE_WIKIPEDIA_ORIGIN` (`simple.wikipedia.org`) as a first-class origin, not an afterthought
  — exactly the source the operator named. `src/services/extract-facts.mjs`'s `ingestText()` is
  the real, shipped pipeline (the same one `tmct_ingest` exposes) that turns arbitrary prose into
  graph triples via the deterministic recognizer. `corpus/reference/` already ships 3,887 Simple
  English Wikipedia summaries as a committed, offline-usable base layer. "Ingest the extra text"
  is not a new capability to build — it's calling `ingestText()` on Wikipedia article bodies
  instead of the graph provenance line, this plan already has, in the form of
  `reference:wikipedia-live:<Title>@<revid>` citations (README's own documented shape).
- **The ontology and inference layer.** `ontology/tmct-core.ttl` is the base OWL vocabulary this
  plan would extend, not replace. `src/domain/syllogise.mjs` is the closure/inference engine —
  relevant, but (§4 below) it does not yet do the kind of reasoning this plan actually needs.

## 1. The temporal graph and ontology — new capability required

Every existing tmct ontology class is timeless: a `Module` either subclasses `Class` or it
doesn't, and the answer doesn't depend on when you ask. A historical city is the opposite —
almost everything is true only for an interval, and the interval is itself an attested fact with
a source and a confidence, not metadata bolted on afterward.

**New capability needed:** a temporal-validity pattern for facts — `validFrom`/`validUntil` (or
an attested-at-date-plus-superseded-by chain) on top of the existing triple shape, plus new
entity classes (`Building`, `Street`, `Shop`, `Resident`, `Occupation`, `Artifact`, ...) under
`tmct-core.ttl` or a sibling ontology file. This is design horizon, not research: **OWL-Time**
(`http://www.w3.org/2006/time#`, a W3C recommendation) is the standard vocabulary for exactly
this — temporal intervals, instants, and their relations — and is real prior art to build the
extension against rather than invent from scratch.

**New capability needed, and the harder half: a persistence/interpolation reasoner.**
`syllogise.mjs` today closes over `rdfs:subClassOf`/`rdf:type` — timeless class membership. This
plan needs a genuinely different kernel: given a fact surveyed at date D1 and no contradicting
record before date D2, does querying at some date between D1 and D2 return that fact, and with
what confidence? This is not a small extension of the existing closure kernels; it's a new
temporal-default reasoning module.

**This is the plan's central research-horizon question**, and it's worth stating plainly rather
than glossing: **tmct's whole product promise is "grounded or an honest miss, never a guess."**
Interpolating "this shop probably still existed in 1861 because the 1859 survey saw it and
nothing says otherwise" is, structurally, a guess — bounded and principled, but a guess. No
settled tmct-shaped answer exists yet for how far a survey's fact should be assumed to persist,
or how that assumption should be surfaced without quietly becoming exactly the kind of
unattributed confidence tmct refuses everywhere else. §3 proposes a resolution (provenance
tagging, not silent assertion) that keeps the product's honesty invariant intact even though the
underlying content is synthesized — but the *policy* (how long a fact "carries forward," and by
what rule) is a real open design question a `PLAN_TEMPORAL_REASONING.md`-shaped follow-on would
need to answer, not something this document can settle.

## 2. Lazy generation on observation — one mechanism, three surfaces

The operator's own description names three things that sound different but are the same
mechanism: room/object detail the graph never recorded, an NPC's whereabouts since last seen, and
whether a takeable object has respawned. All three are **resolve once, on demand, then durable**
— exactly the shape tmct already prefers elsewhere (a fact is either already known or gets
established once and then persists; nothing re-derives on every read).

**New capability required.** Nothing in tmct today generates content probabilistically from a
closed catalogue and asserts it as a durable fact. The shape is buildable with tools this project
already has proven working:

- **Closed-catalogue, weighted sampling — not free text.** A period/neighbourhood's plausible
  occupations, shop types, or household compositions come from real census category frequencies
  (data acquisition is its own question, §6), sampled the way `synthbench/phrasing/`'s
  `PHRASING_FRAMES` and `data/templates/constructions/*.toml` already generate from closed,
  hand-curated vocabularies rather than open generation. The same "closed is deliberate; a
  false-positive is worse than an honest miss" discipline this project already applies to
  language templates applies here to world content: never sample outside what the census
  category data actually supports.
- **Composition via the existing digest machinery.** Once a set of triples is sampled (this
  building had, in this decade, a shop of class X run by a resident with occupation Y), rendering
  that as room/NPC description text reuses the digest engine's opener + grouped-body + closer
  composition, not a new prose generator.
- **NPC catch-up is the same pattern applied to a schedule.** An NPC's routine (where they
  plausibly are on a given day/time, drawn from a small closed set of "likely locations" the
  graph or a hand-authored schedule template names) resolves lazily the first time a player
  observes or asks about them after a gap, then is durable until the next scheduled refresh
  point. `personRoomReport`/`personKnowledgeLines` (already shipped) are the read side; the
  lazy-resolve-and-persist write side is new.
- **Object respawn is a per-class policy, not a simulation clock.** `objectClassChain` (already
  shipped) already resolves an object's class hierarchy — the new piece is attaching a
  persistence policy to a class (`Litter`: respawns generically after N simulated hours;
  `ShopStock`: restocks immediately, generically; `UniqueArtifact`: does not respawn, ever, once
  its removal is recorded) and evaluating it lazily when the object's room is next observed,
  never on a background tick. This needs no new engine — just a policy table keyed by
  `objectClassChain`'s existing output.

## 3. Attested vs. constructed — the provenance mechanism that keeps the honesty promise

Directly answering §1's research question at the mechanism level (the *policy* question — how
far to interpolate — stays open): every fact this world holds gets one of two provenance stamps,
using the same citation shape tmct already uses for live sources
(`reference:wikipedia-live:<Title>@<revid>`):

- **Attested** — sourced from a real historical record, with the record named and dated.
- **Constructed** — sampled to fill a gap (§2), tagged with the generation policy and date it was
  filled, never presented as if a survey recorded it.

A room or NPC description composed from constructed facts says so, plainly, the same way a live
Wikipedia answer already cites `reference:wikipedia-live:...` rather than presenting borrowed
text as tmct's own knowledge. This is the concrete difference between "tmct invents a plausible
fact" (which the product's constitution forbids) and "tmct samples a labelled, disclosed
placeholder from real category data, and remembers having done so" (which keeps every fact
traceable to either a real record or a disclosed, once-made sampling decision — never an
unattributed guess). This piece is design horizon: the mechanism is a provenance field on a
fact row, not a new reasoning capability. Deciding the exact wording/UI treatment of a
"constructed" fact is a smaller, later design pass.

## 4. Wikipedia ingestion for text, images, and links

The operator's ask splits cleanly along a line tmct already draws elsewhere:

- **Extra text gets ingested**, via `ingestText()` (already shipped), the same deterministic
  recognizer `tmct_ingest` uses today. A Simple English Wikipedia article about a real historical
  building becomes graph triples, provenance-stamped `reference:wikipedia-live:<Title>@<revid>`
  — not narrated prose.
- **Images and links get displayed, not generated or ingested as text.** New capability required:
  today's `wikipedia-live.mjs` fetches summaries and page text; it does not fetch or cache
  article images or preserve outbound links as first-class, renderable objects. This is
  design-horizon work (an image-fetch-and-cache step, a link-preservation field on the ingested
  fact), not research — but it's real work, and it's new. Image licensing on Wikipedia/Wikimedia
  Commons varies per file; displaying an image needs the same care tmct already gives to citing
  its text sources, extended to attribution for images specifically.

## 5. Persistence — depends on `PLAN_MUD.md`, one real divergence

This plan reuses `PLAN_MUD.md`'s backend design rather than inventing another one. One place they
diverge, worth naming now rather than discovering it mid-build: `PLAN_MUD.md`'s anonymous tier is
designed around an **8-hour TTL** — deliberately short-lived, a sandbox to try things in. A
historical city that durably fills in generated content (§2, §3) the moment it's first observed
needs that content to **outlive a single visitor's session**, or the "durable" half of the
operator's own description doesn't hold. This plan's world wants `PLAN_MUD.md`'s **Tier 2**
semantics (a private, durable server) as the default even for a casual/anonymous visitor, or a
new tier `PLAN_MUD.md` doesn't currently define: publicly readable, durable, not time-boxed.
`PLAN_MUD.md` already has real precedent for "durable, no TTL" data in its design — the
corpus/lexicon baseline it describes as "seeded separately, by CI, with no TTL at all" — so this
plan's ask is an extension of a pattern `PLAN_MUD.md` already accepts, not a wholly new one:
letting *player-generated* durable content (§2, §3) join that same no-TTL category rather than
only CI-seeded content. Still a design-horizon decision for whoever picks up `PLAN_MUD.md`'s
build, not a research question — but a real product decision, not a detail.

A second, smaller divergence: multiple players can plausibly observe the same never-before-filled
room at close to the same moment (§2's lazy generation racing itself). `PLAN_MUD.md`'s
DynamoDB-shaped backend supports conditional writes; this plan needs a first-writer-wins rule on
the lazy-fill write path so two concurrent observers converge on one generated result rather than
two different ones. Design horizon, not research — but call it out explicitly so it isn't missed
when `PLAN_MUD.md`'s backend is actually built.

## 6. Sourcing real historical data — research horizon, not engineering

Everything above assumes a temporal city graph exists to walk. Getting one is a separate,
real research question this document does not resolve:

- **What's actually available for Amsterdam, and under what licence.** Amsterdam's city archive
  (Stadsarchief Amsterdam) and Dutch national statistics (CBS) hold deep historical
  address/population/census records, some already digitised — but what's programmatically
  accessible, in what format, and under what reuse terms is a research question this document
  hasn't answered and shouldn't guess at.
- **What the census-category sampling (§2) actually needs.** "Weighted by real category
  frequency" only works once real category-frequency tables exist for the relevant decades and
  neighbourhoods — a data-preparation project in its own right, not a code change.
- **Scale.** A single manor house (`adventure.mjs`'s current shipped worlds) and a city are
  different orders of magnitude of graph size and room count. Nothing here identifies a hard
  limit — it's a real open question, not a wall — but it's genuinely unmeasured, and worth a
  scale probe before committing to city-wide coverage over one well-chosen neighbourhood first.

Choosing Amsterdam specifically over a city with more clearly open historical data is itself a
scoping decision worth revisiting once the licensing research above lands.

## 7. Time model

The world's "now" defaults to real wall-clock time — the default entry point is outside 32
Oudezijds Voorburgwal, today, right now — with the ability to travel to any date the graph's
temporal data actually supports (§1). This needs no new mechanism beyond §1's interval reasoning:
"now" is simply the query date when none is otherwise given.

## 8. A worked illustration (not yet buildable — shows what the pieces compose into)

A player arrives outside 32 Oudezijds Voorburgwal, today. The room description composes from
whatever attested facts (§3) the graph holds for that address at the current date, plus
constructed filler (§2) for anything the record doesn't cover, each tagged per its provenance.
The player asks an NPC standing nearby what they do for a living; the answer resolves from a
census-sampled occupation if none was ever attested, generated once and then fixed for that NPC
from then on. The player tells the NPC their own name; a later session, another visit to that
same NPC recalls it (`personKnowledgeLines`, extended to hold player-taught facts the same way
`adventure.mjs` already extends world facts). The player picks up a coin lying in the street;
tomorrow, a different coin is there (`Litter`-class respawn, §2). The player asks about a
specific, real historical artwork once housed nearby; if the graph's temporal data marks it
stolen before the query date, it is honestly gone, not offered, with the theft's own record cited
as the reason. None of this composes today — every piece named above is proposed, not shipped.

## 9. Summary: what's new capability vs. what's research

| piece | status |
|---|---|
| Adventure engine, world-as-fact-rows, discourse binding | **already shipped**, reused as-is |
| Wikipedia ingestion for text (`ingestText`, Simple English origin) | **already shipped**, reused as-is |
| `PLAN_MUD.md` shared persistence | **designed, not yet built** — this plan depends on it |
| Temporal-validity ontology extension (OWL-Time-based) | new capability, design horizon |
| Temporal persistence/interpolation reasoning | new capability, and **the plan's central research horizon** |
| Attested-vs-constructed provenance tagging | new capability, design horizon |
| Closed-catalogue probabilistic content generation | new capability, design horizon (real prior art: `synthbench/phrasing/`, the construction bank) |
| Lazy per-class object respawn policy | new capability, design horizon |
| NPC schedule/story catch-up | new capability, design horizon |
| Wikipedia image fetch/cache + link preservation | new capability, design horizon |
| Durable (non-TTL) shared-world tier | new capability, design horizon, depends on `PLAN_MUD.md` |
| Concurrent-observer race handling on lazy fill | new capability, design horizon, depends on `PLAN_MUD.md` |
| Real historical data acquisition and licensing (Amsterdam) | **research horizon** — outside engineering, needs its own investigation |
| Census category-frequency data for weighted sampling | **research horizon** — a data-preparation project, not a code change |
| City-scale graph size, unmeasured | open question, not yet scoped |

Nine of the twelve new pieces above are design horizon — known engineering, buildable once
someone commits the time, several with real prior art already in this codebase to build against.
Three are genuinely open: the interpolation-policy question (§1), and the two real-world data
questions (§6). None of the three are claimed unreachable — they're named plainly, as this
project's own discipline requires, so a future session can pick them up as actual investigations
rather than rediscovering that they're open.
