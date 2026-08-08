# PLAN_HELP.md — one help page for chat.html and mud.html

Status: DELIVERED, archived 2026-08-08. `public/help.html` is live, tracked, and wired into the
site build. The `#burrow` section specified below shipped and was then removed the same day:
mud.html left the site build (`7245ff0a`) and the operator chose not to restore it, so the page
now covers chat and world sharing only.

## Why one page, and why its own

chat.html and mud.html both need to explain themselves to a first-time visitor, and the shared
world design (`PLAN_MUD.md`, "Proposed next architecture") adds a flow — invite, reply, paste —
that in-page labels can carry step by step but can't teach as a whole. One page, `help.html`,
serves both, so the explanation lives in one place and the demo pages stay uncluttered. It covers
more than sharing (what tmct is, asking and teaching, the burrow itself), which is why it's
specified here rather than inside `PLAN_MUD.md`. It's a static page in the same build as the other
demo pages: no engine, no live state, nothing that acts on a world.

## How it's reached

A small "?" affordance in each page's chrome, opening `help.html` in a new tab so a visitor
mid-invite doesn't lose a pending connection by navigating away. Each page deep-links to its own
section — chat.html to `#chat`, mud.html to `#burrow` — and the invite controls on either page
link straight to `#sharing`. That's a design note, not implementation; the anchors below are the
real contract.

## The page, section by section

Written so the real page can be built from this without more design work. Every section keeps to
the plain-prose rules: short sentences, "you", no term a first-time visitor can't parse.

### `#what` — What this is

Two or three sentences. tmct is a chatbot with no AI model in it anywhere. It answers only from
facts it has been given, and when it can't ground an answer it says so instead of guessing — the
honest miss. Everything on these pages runs in your own browser.

### `#chat` — Asking and teaching (chat.html)

- How to ask: type a question; a grounded answer arrives with a citation naming where the fact
  came from.
- What a miss looks like: the refusal message, and one sentence on why that's the product
  working.
- How to teach: the teach phrasing, what happens next (it cites you back), and that taught facts
  persist in this browser.
- One short worked example of each, copyable as typed.

### `#burrow` — The burrow (mud.html)

- What's on the page: two characters, one shared world, the survey map, the two panes.
- The controls: play and reset, the sliders, the per-pane pills, what `go` and `dig` do, and that
  the surface only digs down.
- The fox, in one sentence.
- Waving: type `wave` or click the hand button; everyone watching that room — you included — sees
  a hand wave over your character. That's all it does, and that's the point: it's the quickest
  way to check that other viewers of a shared room really see what you do.

### `#sharing` — Sharing a world

The section the invite controls deep-link to. It walks the two-paste flow exactly as
`PLAN_MUD.md`'s "The invite flow, as each person sees it" resolves it, in second person from each
side:

- Inviting: click "invite someone"; a link is copied; send it however you already talk to that
  person; keep the tab open; paste their reply into the one box on your page; their row appearing
  in the node list is your confirmation.
- Joining: open the link; read the join card; click "create my reply"; send the copied reply back
  the same way the invite reached you; keep the tab open; the connection completing is your
  confirmation, and you never paste anything.
- The rules that stop confusion, one sentence each: a link invites one person, so share again for
  the next; both of you have to be at your machines at the same time — a link is a phone call,
  not a mailbox; whoever joins can invite the next person, and after that first paste everyone
  gets connected to everyone automatically.

### `#nodes` — Nodes and names

What a node is (one browser holding a full copy of the world). Where its name comes from (two
words drawn from the world's own vocabulary, until you change it). How to change yours. Where
other nodes show up: the node list, and under a character's name in the burrow when another node
plays it.

### `#trouble` — When something goes wrong

A two-column table, symptom then what to do:

| symptom | what to do |
| --- | --- |
| the link says "this invite looks cut short" | the copy lost part of the link — ask for it again and make sure the whole thing travels |
| pasting a reply did nothing visible | read the message under the box; it says exactly what was wrong (cut short, an invite instead of a reply, or a reply for a different world), and your text stays in the box so you can fix it |
| "waiting for a reply" for a long time | nothing is wrong yet — nothing happens until the other person sends their reply back and it's pasted; the wait ends when they do |
| "that invite has already been used" | each link admits one person — mint a fresh one with the invite button |
| "your two machines can't reach each other" | connections work between machines on the same network, or ones that can already see each other directly; try again from the same network |
| someone's row went quiet | they closed their tab or dropped offline — everything they contributed stays, and a fresh invite reconnects them |

### `#more` — Where the deeper story lives

One line linking to the home page's demonstrations and the README for the design and the
benchmarks.

## What this page doesn't do

It explains; it doesn't operate. No live connection state, no buttons that act on a world — those
stay on the pages that own them, so the help page stays a plain static document.
