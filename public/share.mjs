// The share control on each demo card.
//
// Every demo carries five written posts. They are here rather than generated
// because each one takes a different angle and lands on a different page, and
// a template cannot do either. Deep links point at the about pages' own section
// ids (#what, #play, #shots, #inference, #build, #papers, #credits), which is
// what those ids are for.
//
// One link carries a query parameter: index.html?q= primes the home page's live
// demo box with a question, which public/demo-ui.mjs actually reads. No other
// page on this site reads a parameter that suits a shared link, so every other
// post links plainly.
//
// Sharing goes through navigator.share where the browser has it, with the demo's
// screenshot attached when the browser will carry files. Where it does not, the
// sheet still copies the text and shows the link.

const SCREENSHOT = {
  chat: "chat.png",
  "spider-fly": "spider-fly.png",
  plan: "plan.png",
  adventure: "adventure.png",
  ledger: "ledger.png",
  code: "code.png",
  ingest: "ingest.png",
  sprites: "sprites.png",
  research: "research.png",
  mud: "mud.png",
  mudiii: "mudiii.png",
};

const POSTS = {
  chat: {
    title: "Natural Language Understanding",
    posts: [
      { angle: "what it is", to: "chat.html",
        text: "A chatbot with no model behind it. It answers from facts it can point at, and when it has nothing it says so. Runs entirely in your browser." },
      { angle: "the honest miss", to: "chat-about.html#inference",
        text: "Most of the work in this went into what it does when it does not know. It refuses. It never fills the gap with something plausible. Here is how that is built." },
      { angle: "a real exchange", to: "chat-about.html#play",
        text: "Teach it that Rover is a dog, ask if Rover barks, and it answers yes while naming both facts it chained through. Every transcript on this page is a test that runs on each build." },
      { angle: "the reading behind it", to: "chat-about.html#papers",
        text: "Refusing to answer has a literature. Chow wrote the reject option up in 1970 and Reiter wrote the open world assumption up in 1978. This page lists what the design rests on." },
      { angle: "how it is put together", to: "chat-about.html#build",
        text: "No server, no API key, no model. One bundle, one seed file of about 63,000 facts, and wink-nlp for lemmas. Here is the whole stack." },
      { angle: "try a question", to: "index.html?q=what%20calls%20Task",
        text: "The box on this page runs the real engine on a real code graph, live in your browser, primed with a question. Type your own over the top of it." },
    ],
  },
  "spider-fly": {
    title: "Competitive multi-agent system",
    posts: [
      { angle: "what it is", to: "spider-fly.html",
        text: "A spider and a fly on one board, each planning its own next move, each seeing only part of it. Neither is yours to play." },
      { angle: "you can lie to it", to: "spider-fly-about.html#play",
        text: "Tell the spider the fly is east and it will act on that, whether or not it is true. What an agent was told is stored as a fact, and it can be a wrong one." },
      { angle: "how belief works", to: "spider-fly-about.html#inference",
        text: "Each agent's view of the other is one function with four rungs: known if in range, otherwise the newest thing it was told, otherwise nothing. No line of sight test, on purpose." },
      { angle: "the reading behind it", to: "spider-fly-about.html#papers",
        text: "Belief, desire, intention, from Rao and Georgeff in 1995. This page sets out which parts of that the demo actually implements and which it does not." },
      { angle: "how it is put together", to: "spider-fly-about.html#build",
        text: "The tick engine is written against roles rather than species, so the same code runs the spider and the town square fox. Here is the module layout." },
    ],
  },
  plan: {
    title: "Classical AI Planning",
    posts: [
      { angle: "what it is", to: "plan.html",
        text: "Teach it the rules of Tower of Hanoi in plain English, then say solve it. It searches, finds the shortest plan, and replays it move by move." },
      { angle: "it shows the working", to: "plan-about.html#inference",
        text: "The plan comes out as a PDDL problem and as OWL triples. Both are generated from the plan itself, so they cannot drift from what it actually did." },
      { angle: "a real exchange", to: "plan-about.html#play",
        text: "Ask it to solve with no rules taught and it says no action rules taught yet, teach the game first. Every transcript on this page is a corpus test." },
      { angle: "the reading behind it", to: "plan-about.html#papers",
        text: "STRIPS from 1971, PDDL from 1998, and Ghallab, Nau and Traverso for the modern account. This page lists what the planner is built on." },
      { angle: "how it is put together", to: "plan-about.html#build",
        text: "A bounded breadth-first search over states that are just lists of triples. Breadth-first is why the answer is the shortest plan rather than any plan." },
    ],
  },
  adventure: {
    title: "Fact based world visualisation",
    posts: [
      { angle: "what it is", to: "adventure.html",
        text: "A small manor built out of triples. The room view draws exactly what the facts say is there, and nothing else." },
      { angle: "why the picture cannot lie", to: "adventure-about.html#inference",
        text: "There is no render list to keep in step with the prose. Close the cabinet and the letter stops resolving to a visible room, so it stops being drawn." },
      { angle: "it finds its own goal", to: "adventure-about.html#what",
        text: "The auto-player is not scripted. One generic marker fact says which object is the objective, and it works out the rest by exploring and pathing to what it has found." },
      { angle: "a real playthrough", to: "adventure-about.html#play",
        text: "Fourteen turns from the study to the letter, take the portrait, open it, take the key, unlock the cabinet. The whole sequence is asserted as a test." },
      { angle: "the reading behind it", to: "adventure-about.html#papers",
        text: "A room is a set of triples, so RDF 1.1 Semantics says what claiming one commits you to. Taking the lamp is a STRIPS add and delete. Here is the reference list." },
      { angle: "look at it", to: "adventure-about.html#shots",
        text: "One room of Ashcombe Hall, drawn from the rows that describe it, with the map and what you are carrying alongside." },
    ],
  },
  ledger: {
    title: "Facts as RDF/OWL triples",
    posts: [
      { angle: "what it is", to: "ledger.html",
        text: "The whole memory, opened up. Every row is a triple, every triple names its source, and every term in it is a link you can follow." },
      { angle: "how far to trust a fact", to: "ledger-about.html#inference",
        text: "Every fact carries a provenance tag, and each kind of source has a prior. Operator 1.0, taught 0.95, corpus 0.7, live Wikipedia 0.5, entailed 0.3. Nothing is guessed at." },
      { angle: "the standards it follows", to: "ledger-about.html#papers",
        text: "OWL 2, RDF 1.1 Semantics and PROV-O, followed rather than reinvented. Provenance semirings for what happens when one fact rests on several sources." },
      { angle: "a real exchange", to: "ledger-about.html#play",
        text: "Teach a fact through the dock and watch the total go up by one, the tier bar move, and the focus card land on the new term. All asserted in a browser test." },
      { angle: "how it is put together", to: "ledger-about.html#build",
        text: "One pure function from a memory payload to rows, terms, edges and contradictions, and one renderer. The command line writes the same page." },
    ],
  },
  code: {
    title: "Code Index for RAG",
    posts: [
      { angle: "what it is", to: "code.html",
        text: "Ask about a codebase in English and get an answer off a graph of imports, calls and members. No embeddings anywhere in it." },
      { angle: "it holds a thread", to: "code-about.html#play",
        text: "Ask what talks to a module, then ask what calls it, without naming anything. The pronoun binds to the last resolved answer. Cold, it says the pronoun resolved to nothing." },
      { angle: "what the graph carries", to: "code-about.html#inference",
        text: "Typed edges, not text similarity: imports, calls, defines, tests, touches, contains, inherits. A transitive question walks a reverse closure over them." },
      { angle: "the vocabulary", to: "code-about.html#papers",
        text: "The classes come from SEON's code ontology, published in 2012, rather than a schema invented for this. Here is the reference list." },
      { angle: "how it is put together", to: "code-about.html#build",
        text: "One question grammar, shared with every other ask box on the site, over a graph built from a real committed fixture app. The tool layer runs 125 assertions in 0.4 seconds." },
    ],
  },
  ingest: {
    title: "Synthesise Facts from free text",
    posts: [
      { angle: "what it is", to: "ingest.html",
        text: "Paste a paragraph. Each sentence it recognises becomes a triple you can export. Each one it does not is skipped and counted." },
      { angle: "the skip count is the point", to: "ingest-about.html#play",
        text: "Four sentences in, two out. A question is not a fact and a citation marker is not part of one. A tool that grounded all four would be making things up." },
      { angle: "how the recognizer works", to: "ingest-about.html#inference",
        text: "Three attempts per sentence: the whole thing, then clause by clause, then one pronoun substitution. No scoring pass keeps the best guess. It matches or it does not." },
      { angle: "the reading behind it", to: "ingest-about.html#papers",
        text: "Attempto Controlled English for the subset it reads, Chow's reject option for the skip count. Extraction that declines is the same idea as answering that declines." },
      { angle: "how it is put together", to: "ingest-about.html#build",
        text: "The browser recognizer and the command line's extract command are the same function. Output is canonical JSONL, one object per line." },
    ],
  },
  sprites: {
    title: "The sprite library",
    posts: [
      { angle: "what it is", to: "sprites.html",
        text: "Every shape the site can draw, next to the ontology class it belongs to. A word with no shape of its own borrows its nearest ancestor's." },
      { angle: "a sheepdog draws as a dog", to: "sprites-about.html#inference",
        text: "Not a lookup table with a default and not a similarity score. It asks what the word is a kind of, keeps asking, and takes the first answer it has a shape for." },
      { angle: "the facts behind it", to: "sprites-about.html#play",
        text: "Remove the spider shape and it walks spider to arachnid to animal and draws an animal. Every step is a real subClassOf row you can read." },
      { angle: "the reading behind it", to: "sprites-about.html#papers",
        text: "The walk is a syllogism. All poodles are dogs, all dogs are animals, so all poodles are animals. Aristotle got there first; OWL 2 says what it licenses." },
      { angle: "how it is put together", to: "sprites-about.html#build",
        text: "Two tiers of plain TOML, one resolver, and a catalog that resolves every card through the real resolver so it cannot disagree with what a game page draws." },
    ],
  },
  research: {
    title: "Search backed knowledge base",
    posts: [
      { angle: "what it is", to: "research.html",
        text: "One graph, grown three ways. Research a term over Simple English Wikipedia, teach a fact, or paste a document. Then ask a question scoped to the sources you trust." },
      { angle: "turn a source off", to: "research-about.html#play",
        text: "Ask something, get an answer, untick where it came from, ask again, and watch it decline. The scoped miss is a real miss over a smaller graph." },
      { angle: "how scoping works", to: "research-about.html#inference",
        text: "Unchecking a source does not filter the answer. It removes those facts from a copy of the store and asks the real question against what is left." },
      { angle: "the reading behind it", to: "research-about.html#papers",
        text: "Provenance semirings for which answers survive when a source is removed, PROV-O for the model, Reiter for why the result is a miss rather than a denial." },
      { angle: "how it is put together", to: "research-about.html#build",
        text: "Three real engine paths growing one store, not three copies of one. A research run reports which of its three bounds stopped it." },
    ],
  },
  mud: {
    title: "Competitive multi-agent system with Fact based visualisation",
    posts: [
      { angle: "what it is", to: "mud.html",
        text: "Four burrowing animals dig, eat and explore one shared muddy world. Each only knows what it has personally found out." },
      { angle: "knowledge is a fact", to: "mud-about.html#inference",
        text: "What a character knows is a row in the graph, tagged with who said it and on which turn. Two characters can be in one world and disagree about it." },
      { angle: "firsthand beats hearsay", to: "mud-about.html#what",
        text: "When two claims about the same thing compete, a fresh look beats a stale rumour. The ranking is newest epoch, then seen over told, then later turn." },
      { angle: "a real exchange", to: "mud-about.html#play",
        text: "One character greets another and hears nothing new about food, because the other genuinely knows nothing. The honest miss written as behaviour rather than as a sentence." },
      { angle: "the reading behind it", to: "mud-about.html#papers",
        text: "Belief, desire, intention for the characters, PROV-O for the testimony tags, and the 2011 CRDT work for why ranking competing claims never depends on arrival order." },
    ],
  },
  mudiii: {
    title: "MMORPG",
    posts: [
      { angle: "what it is", to: "mudiii.html",
        text: "A fox and a handful of goblins each planning their own moves across a town square in three dimensions. Nothing calls a model." },
      { angle: "why a goblin walks into a fox", to: "mudiii-about.html#inference",
        text: "It is not a bug and it is not scripted. The plan was computed against what the goblin believed, and the fox was not in it." },
      { angle: "you can lie to it", to: "mudiii-about.html#play",
        text: "Tell the fox where the goblin is and it believes you. Talking to a character writes a real addressed fact, read back exactly like something it saw." },
      { angle: "the reading behind it", to: "mudiii-about.html#papers",
        text: "Planning under partial observability, from Steel and Ho in 1993 through to Ghallab, Nau and Traverso. Here is what the tick loop actually implements." },
      { angle: "how it is put together", to: "mudiii-about.html#build",
        text: "The same tick engine as the flat board demo, with a three.js scene on top. The 3D bundle is only built for a site that actually ships this page." },
      { angle: "look at it", to: "mudiii-about.html#shots",
        text: "A fox and three goblins on the town square, each acting on its own view of it, with the HUD showing what each one currently wants." },
    ],
  },
};

const HERE = new URL(".", location.href);
const absolute = (to) => new URL(to, HERE).href;

function buildSheet() {
  const sheet = document.createElement("dialog");
  sheet.className = "share-sheet";
  sheet.innerHTML = `
    <div class="share-head">
      <div>
        <h2 class="share-title"></h2>
        <p>Five ways to post about it. Each one takes a different angle and opens a different page.</p>
      </div>
      <button class="share-close" type="button" aria-label="Close">&times;</button>
    </div>
    <ul class="share-list"></ul>
    <p class="share-note"></p>`;
  document.body.append(sheet);
  sheet.querySelector(".share-close").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });
  return sheet;
}

/** The demo's screenshot as a File, or null when the browser will not carry
 *  files or the image cannot be read. A share without the picture still works. */
async function screenshotFile(demo) {
  const name = SCREENSHOT[demo];
  if (!name || typeof File !== "function" || !navigator.canShare) return null;
  try {
    const res = await fetch(absolute(`screenshots/${name}`));
    if (!res.ok) return null;
    const blob = await res.blob();
    const file = new File([blob], name, { type: blob.type || "image/png" });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.left = "-9999px";
  document.body.append(box);
  box.select();
  const ok = document.execCommand?.("copy") ?? false;
  box.remove();
  return ok;
}

function flash(button, word) {
  const was = button.textContent;
  button.textContent = word;
  button.dataset.done = "1";
  setTimeout(() => {
    button.textContent = was;
    delete button.dataset.done;
  }, 1600);
}

function fillSheet(sheet, demo) {
  const entry = POSTS[demo];
  sheet.querySelector(".share-title").textContent = `Share: ${entry.title}`;
  const canShare = typeof navigator.share === "function";
  sheet.querySelector(".share-note").textContent = canShare
    ? "Your device's share sheet carries the screenshot too, where it supports files."
    : "This browser has no share sheet, so copy the post and the link instead.";

  const list = sheet.querySelector(".share-list");
  list.replaceChildren();
  for (const post of entry.posts) {
    const url = absolute(post.to);
    const item = document.createElement("li");
    item.className = "share-post";
    item.innerHTML = `
      <p class="share-angle"></p>
      <p class="share-text"></p>
      <a class="share-target"></a>
      <div class="share-row"></div>`;
    item.querySelector(".share-angle").textContent = post.angle;
    item.querySelector(".share-text").textContent = post.text;
    const target = item.querySelector(".share-target");
    target.textContent = post.to;
    target.href = url;

    const row = item.querySelector(".share-row");
    if (canShare) {
      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "share-act";
      shareBtn.textContent = "Share";
      shareBtn.addEventListener("click", async () => {
        const payload = { title: entry.title, text: post.text, url };
        const file = await screenshotFile(demo);
        if (file) payload.files = [file];
        try {
          await navigator.share(payload);
        } catch (err) {
          // A cancelled share sheet rejects. That is a choice, not a failure.
          if (err?.name === "AbortError") return;
          if (await copyText(`${post.text}\n${url}`)) flash(shareBtn, "Copied");
        }
      });
      row.append(shareBtn);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "share-act";
    copyBtn.textContent = "Copy post";
    copyBtn.addEventListener("click", async () => {
      if (await copyText(`${post.text}\n${url}`)) flash(copyBtn, "Copied");
    });
    row.append(copyBtn);

    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "share-act";
    linkBtn.textContent = "Copy link";
    linkBtn.addEventListener("click", async () => {
      if (await copyText(url)) flash(linkBtn, "Copied");
    });
    row.append(linkBtn);

    list.append(item);
  }
}

const buttons = [...document.querySelectorAll(".share-btn")];
if (buttons.length) {
  const sheet = buildSheet();
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const demo = button.dataset.shareDemo;
      if (!POSTS[demo]) return;
      fillSheet(sheet, demo);
      sheet.showModal();
    });
  }
}
