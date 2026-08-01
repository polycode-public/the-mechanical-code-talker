# PLAN_BARTLE.md — MUD lineage and naming research for MUDIII

Split out of `PLAN_MUD.md`'s MUDIII section. This document is the lineage/history background and
the naming research behind the name "MUDIII", kept separate from the game design itself so
`PLAN_MUD.md` stays about what gets built.

## Lineage notes (verified 2026-07-30)

The genre this page joins started at the operator's own university: Roy Trubshaw wrote the
first MUD on Essex University's DEC PDP-10 in 1978 (first in MACRO-10 assembler, then BCPL),
and Richard Bartle, a fellow Essex student, took it over in 1980 and built out most of the
world (en.wikipedia.org/wiki/MUD1; mud.co.uk). Essex MUD ran on the university machine into
the late 1980s; MUD1 ran commercially on CompuServe as "British Legends" from 1985 until
CompuServe's Y2K cleanup retired it in late 1999, and a licensed revival still runs at
british-legends.com. MUD2, the 1985 successor, is still live — one of its two instances is
`mudii.co.uk` (see below). Bartle released MUD1's 1986 source on GitHub in 2020 under
a custom not-for-profit licence (github.com/PDP-10/MUD1).

Two details of MUD1's own design are worth naming because this project independently repeats
them. First, engine/content separation: MUD1's world was data, not code — rooms, objects and
puzzles defined in MUDDL, the Multi-User Dungeon Definition Language, interpreted by a BCPL
engine (mud.co.uk/muse/muddl.htm; the MUDDL definition PDF ships in the GitHub repo). tmct's
worlds pack — a game as fact rows a fixed engine folds — is the same architecture nearly fifty
years on, with the definition language upgraded to OWL-labelled triples. Second, on the
question of a rendered successor: asked about a hypothetical MUD3, Bartle said it "would have
to be a graphical world, because no-one would play it otherwise", that he was "some
£50,000,000 short of the funding", and that he owned MUD3D.com for years before letting it
lapse when it was clear he would never build it (arcadeattack.co.uk/richard-bartle/). A small
rendered world over a text engine is squarely the shape he named — which cuts both ways, as
the next section explains.

## Naming and lineage — research on the name "MUDIII"

**This section is informational research, not legal advice.** It records what was actually
found on 2026-07-30, with sources, plus a risk read that is one researcher's opinion. Before
any public use of "MUD"-derived branding — registering `mudiii.co.uk`, linking a page named
MUDIII from tmct's home page — get a real trademark/IP attorney's opinion, ideally one who
handles UK passing-off.

### What the research found

**The trademark question.** "MUD" was taken as a registered trademark by MUSE Ltd (Multi-User
Entertainment Ltd), the company Trubshaw, Bartle and Simon Dally formed in 1985 to
commercialize MUD (en.wikipedia.org/wiki/MUD1; mud.co.uk/muse/backgrnd.htm). The current
status of that registration could not be verified from here: the UK IPO's trademark search
(trademarks.ipo.gov.uk) is a JavaScript application this environment could not query, and its
root served a "Service Unavailable" page during the attempt. What the reachable searches did
show: no live "MUD" word mark for games surfaced in US-register secondary sources (only
unrelated marks like MUD TRAX and MUDDIN', abandoned or cancelled); MUSE Ltd no longer appears
on the active Companies House register (an advanced-search sweep of "multi-user" company names
returns eleven companies, none of them Multi-User Entertainment — though Companies House only
fully lists dissolutions since 2010, so read this as "long gone", never as a dated proof); and
no record surfaced anywhere of MUSE or Bartle enforcing the mark against any of the thousands
of games that have called themselves MUDs. mudii.co.uk's own FAQ still states "MUSE (or
Multi-User Entertainment Ltd) owns the rights to MUD2". An attorney should run the actual IPO
register check; it is cheap and definitive.

**The genericization question.** As a genre term, "MUD" is about as generic as a coined term
gets: by 1995 some 600 games called themselves MUDs
(en.wikipedia.org/wiki/Multi-user_dungeon), the acronym was freely reinterpreted ("dimension",
"domain"), a whole family of derivative terms (MUCK, MUSH, MU*) grew from it, and reference
works from Wikipedia to Britannica use "a MUD" as a common noun. Bartle's own public writing
uses it generically. Using "MUD" descriptively — "a MUD", "MUD-style", "in the MUD tradition"
— is the safest imaginable use of the word. Branding a product with a MUD-series name is a
different act, and that is where the rest of this analysis lives.

**Bartle's own posture.** Everything found points to permissiveness about the genre and
generosity with its history: he chose against locking the original up ("we could have clamped
some intellectual property on it, but the reason that Roy and I wrote MUD wasn't to make
money, it was because we wanted to make the real world a better place" — mattbarton.net/?p=1019,
the Matt Chat interview), he released MUD1's source in 2020, and mud.co.uk hosts the genre's
history for everyone. No statement was found of him objecting to anyone's use of "MUD" as a
genre word. The specific name "MUD3" is different: he has publicly reserved it, rhetorically,
for his own unbuilt dream game (the £50M and MUD3D.com quotes above). And no other project
called "MUD3"/"MUD III"/"MUDIII" was found anywhere — no game, no product, no domain (a TikTok
handle aside). The name is unclaimed precisely because the community treats it as Bartle's to
claim.

**What mudii.co.uk actually is.** A live, community-run home of MUD2 itself — the game, not a
fan page. The domain was registered 17 Jan 2001, is renewed through 17 Jan 2027, and was last
updated December 2025 (Nominet WHOIS); the site posts news through 2024 (a Discord server) and
lists player events from summer 2025; the game answers on telnet port 23. The FAQ states
Richard Bartle "is still active in the running of both MUD2s including MUDII". The missing SSL
certificate means only that it is a plain-HTTP site of 2001 vintage, and nothing more. This
matters more than any trademark: "MUDII" is the literal current name of a live service with 25
years of goodwill, at a domain one letter from `mudiii.co.uk`.

### The risk read (opinion, not clearance)

The trademark-register risk looks low: the 1985 registration's owner has apparently been gone
from the company register for over a decade, no live games-class "MUD" mark surfaced, the
genre term is thoroughly generic, and no history of enforcement was found. The real exposure
sits elsewhere, in three stacked facts this research established. UK passing-off needs no
registered mark (the classic test is goodwill, misrepresentation, damage). "MUDII" is a live
named service, and "MUDIII" is its successor by the naming convention the series itself
established (MUD1 → MUD2 → MUDII). And Bartle has publicly staked "MUD3" as the name of his
own hypothetical next game. A page called MUDIII at mudiii.co.uk, with no further context,
does not read as "a new game in the MUD tradition". It reads as the next release of the thing
at mudii.co.uk, by the people who run it — a misrepresentation of origin even with the
friendliest intent — and it claims the one name in the namespace the community understands to
be reserved for its founder. The people most likely to notice are the small, living MUD
community, and its founder is active in it.

Prominent credit changes the ethical picture and part of the legal one. A visible line on the
page itself — named in homage to MUD1 and MUD2, created by Roy Trubshaw and Richard Bartle at
the University of Essex from 1978; this project is not affiliated with, or endorsed by, them,
MUSE Ltd, mudii.co.uk or british-legends.com — is the difference between homage and
impersonation as a matter of good faith, and credit-plus-disclaimer weighs against confusion.
What a disclaimer cannot fully cure is a name that itself asserts succession; that is why the
attorney consult comes before the domain registration, not after.

One move dominates all of this: ask Bartle. He is publicly reachable (mud.co.uk carries his
contact details), famously responsive on MUD history, and the operator is an Essex alumnus
building a deterministic, text-first world engine — squarely the tradition he founded and
still gives his time to. His blessing converts the largest risk into the strongest possible
asset (a lineage claim with the founder's nod); his objection, arriving before anything ships,
costs a rename of one unshipped page. Either answer is worth more than any further desk
research. If the name must proceed unblessed, the fallback keeps the homage explicit and the
succession implicit: brand the page inside tmct's own namespace and let the MUD lineage live
in the credit line rather than the product name. The design in `PLAN_MUD.md` does not change
under any of these outcomes; only the masthead does.

Sources checked 2026-07-30: en.wikipedia.org/wiki/MUD1, /MUD2, /Multi-user_dungeon,
/Richard_Bartle; mud.co.uk (MUSE pages); mudii.co.uk (home + FAQ, via plain HTTP);
british-legends.com (history); arcadeattack.co.uk/richard-bartle/; mattbarton.net/?p=1019;
Nominet WHOIS for mudii.co.uk and mudiii.co.uk; Companies House advanced search;
trademarks.ipo.gov.uk (unreachable from this environment — flagged for the attorney);
US-register secondary sources (trademarks.justia.com).

**Operator's chosen sequencing (2026-07-30), superseding "ask Bartle first" above.** Ship
`mudiii.html` first, with credit-line prose in the spirit of `mud.html`'s own inspiration
section — naming MUD1/MUD2 and Trubshaw/Bartle plainly — and give world-of-claudecraft a strong,
visible credit on the same page. Once that's live at `mudiii.co.uk`, the operator will message
Richard Bartle directly, in person, rather than have this session draft or send anything on
their behalf. The attorney-consult point above still stands as its own, separate consideration —
this note is about the ORDER of shipping vs. contacting Bartle, not a substitute for it.
