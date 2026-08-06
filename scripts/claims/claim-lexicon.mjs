// scripts/claims/claim-lexicon.mjs — E2, "bounded, inspectable, extensible":
// publishes the four lemma counts in the committed core lexicon
// (lexicon-core.json), then two vocabulary-coverage readings around one
// extension load: the out-of-vocabulary rate against a 5,000-lemma
// English frequency sample (the everyday-world coverage the CORE lexicon
// gives, unextended), and the out-of-vocabulary rate on a code-domain
// prose sample AFTER the code-terms lexicon extension loads (the coverage
// one authored extension buys for its own domain). Both readings count
// only content words — closed-class function words (articles,
// prepositions, auxiliaries) sit outside what this lexicon ever declares,
// so counting them as "vocabulary" would measure grammar coverage, not
// vocabulary coverage.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadLexicon, lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
} from "../../src/domain/grammar/lexicon.mjs";
import coreLexiconRaw from "../../src/domain/grammar/lexicon-core.json" with { type: "json" };
import { writeClaim, defaultHardware, ROOT } from "./lib.mjs";

const FREQUENCY_SAMPLE_PATH = join(ROOT, "test-benchmarks", "claims", "frequency-top5000.txt");
const DOMAIN_LEXICON_PATH = join(ROOT, "test-benchmarks", "claims", "code-terms-lexicon.json");
const LOAD_COMMAND = "tmct import --lexicon test-benchmarks/claims/code-terms-lexicon.json";

const EXPECTED_COUNTS = { nouns: 9321, verbs: 93, adjectives: 65, properNames: 22 };

// General-prose function words: articles, pronouns, prepositions, conjunctions,
// auxiliaries and the copula. Closed-class — this lexicon never declares any of
// these as a noun/verb/adjective, so leaving them in would measure grammar
// coverage rather than vocabulary coverage.
const STOPWORDS_FOR_OOV = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "as", "into", "over",
  "under", "between", "through", "about", "against", "during", "before", "after",
  "above", "below", "up", "down", "out", "off", "again", "further", "then", "once",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "have", "has", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "not", "no", "nor", "if", "than", "too", "very", "just", "also", "when",
  "where", "who", "whom", "which", "what", "why", "how", "there", "here",
  "each", "every", "both", "few", "more", "most", "other", "some", "such",
  "only", "own", "same",
]);

const tokenize = (text) => String(text)
  .toLowerCase()
  .replace(/[^a-z\s-]/g, " ")
  .split(/\s+/)
  .filter(Boolean);

const contentTokens = (tokens) => tokens.filter((t) => t.length > 1 && !STOPWORDS_FOR_OOV.has(t));

function inVocabulary(word, lexicon) {
  return Boolean(
    lookupNoun(lexicon, word) || lookupVerb(lexicon, word)
    || lookupAdjective(lexicon, word) || lookupProperName(lexicon, word),
  );
}

function oovPercent(tokens, lexicon) {
  const content = contentTokens(tokens);
  if (!content.length) return 0;
  const out = content.filter((w) => !inVocabulary(w, lexicon));
  return (out.length / content.length) * 100;
}

// ~50 sentences of code-flavoured prose, written for this rig, exercising the
// code-terms-lexicon.json vocabulary in natural sentence context rather than
// as a bare word list.
const CODE_DOMAIN_SENTENCES = [
  "The team decided to containerize the legacy service before the next release.",
  "Every microservice registers itself with the gateway on startup.",
  "The gateway forwards each payload to the correct namespace inside the cluster.",
  "A rollout with no canary stage skips the safety net entirely.",
  "The autoscaling policy watches throughput and adds replicas under load.",
  "Kubernetes rescheduled the pod after the node reported memory pressure.",
  "The engineer wrote a hotfix to patch the vulnerability before the weekend.",
  "Provisioning a new subnet took longer than the terraform plan suggested.",
  "The middleware validates the credential before the request reaches the handler.",
  "Encryption at rest protects the checksum store from casual tampering.",
  "A flaky test made the pipeline fail without any real regression.",
  "The bundler failed to resolve the shim after the dependency upgrade.",
  "Webpack rebuilt the sourcemap once the transpiler finished its pass.",
  "The polyfill kept the older browser from throwing on the missing method.",
  "A well-placed breakpoint saved an afternoon of guessing at the stacktrace.",
  "The profiler pointed straight at the function causing the backpressure.",
  "Sharding the table reduced query latency during the busiest hour.",
  "The registry rejected the image because its checksum did not match.",
  "A webhook fires whenever the changelog gains a new entry.",
  "The monorepo made the boilerplate easier to share across services.",
  "Linting caught the unused import before it reached the review.",
  "The daemon retried the handshake three times before giving up.",
  "Observability dashboards made the incident easy to diagnose overnight.",
  "Tracing showed the span where the request lost most of its time.",
  "The sandbox environment mirrors staging without touching real credentials.",
  "A single flaky node can cause backoff storms across the whole mesh.",
  "The consensus protocol needs a quorum before it commits any change.",
  "Rollback restored the previous replica within a couple of minutes.",
  "The firmware update introduced jitter nobody had seen before.",
  "Authenticate the caller before you authorize the request.",
  "The factory method builds a new instance without exposing its constructor.",
  "A decorator wraps the function without changing its declared signature.",
  "The iterator walks the collection lazily instead of loading it all at once.",
  "Serialize the object before you send it across the socket.",
  "Deserializing untrusted input without sanitizing it first is asking for trouble.",
  "The coroutine yields control back to the scheduler between steps.",
  "Memoize the expensive calculation so the second call is instant.",
  "The mixin adds logging behaviour to every class that includes it.",
  "Normalize the schema before you denormalize it again for reporting.",
  "Tokenize the input stream before the parser ever sees it.",
  "The annotation tells the compiler to treat the field as read-only.",
  "Encapsulation keeps the internal state away from careless callers.",
  "Polymorphism lets the same call behave differently depending on the type.",
  "An idempotent request can be retried safely without side effects.",
  "The service stays stateless so any replica can answer the next request.",
  "An ephemeral container disappears the moment its job finishes.",
  "Asynchronous code can run concurrent tasks without blocking the thread.",
  "A distributed system has to tolerate partial failure by design.",
  "The transaction is atomic, so a crash midway leaves nothing half-written.",
  "A declarative configuration describes the desired state, not the steps to reach it.",
  "The queue accepts a lossy delivery mode when speed matters more than certainty.",
];

async function main() {
  const counts = {
    nouns: Object.keys(coreLexiconRaw.nouns).length,
    verbs: Object.keys(coreLexiconRaw.verbs).length,
    adjectives: Object.keys(coreLexiconRaw.adjectives).length,
    properNames: coreLexiconRaw.properNames.length,
  };
  const drifted = Object.entries(EXPECTED_COUNTS).filter(([k, v]) => counts[k] !== v);
  if (drifted.length) {
    throw new Error(
      `claim:lexicon: lexicon-core.json's counts drifted from the ground truth this claim `
      + `expects (${drifted.map(([k, v]) => `${k}: expected ${v}, got ${counts[k]}`).join("; ")}). `
      + "Stop and reconcile before publishing this claim.",
    );
  }

  const frequencyWords = (await readFile(FREQUENCY_SAMPLE_PATH, "utf8"))
    .split("\n").map((w) => w.trim()).filter(Boolean);
  const domainExtra = JSON.parse(await readFile(DOMAIN_LEXICON_PATH, "utf8"));

  const coreLexicon = loadLexicon();
  const before = oovPercent(frequencyWords, coreLexicon);

  const extendedLexicon = loadLexicon(domainExtra);
  const domainTokens = CODE_DOMAIN_SENTENCES.flatMap((s) => tokenize(s));
  const after = oovPercent(domainTokens, extendedLexicon);

  const delta = after - before;
  // writeClaim's regression check compares against `delta` (lib.mjs: a
  // before/after/delta payload's compareValue is the delta), not `after`
  // directly. `before` is deterministic (a fixed sample against the frozen
  // core lexicon), so a delta-space ceiling of `delta + 2` enforces exactly
  // a "max on after, 2-point headroom" ceiling as long as `before` holds
  // steady run to run — the intended regression signal, expressed in the
  // space the harness actually checks.
  const record = writeClaim("lexicon", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "percent",
    before, after, delta,
    threshold: { direction: "max", value: delta + 2 },
    sources: [
      "src/domain/grammar/lexicon-core.json",
      "test-benchmarks/claims/frequency-top5000.txt",
      "test-benchmarks/claims/frequency-top5000.LICENSE",
      "test-benchmarks/claims/code-terms-lexicon.json",
      "scripts/claims/claim-lexicon.mjs",
    ],
    detail: {
      counts,
      command: LOAD_COMMAND,
      frequencySampleSize: frequencyWords.length,
      domainSentenceCount: CODE_DOMAIN_SENTENCES.length,
      domainContentTokenCount: contentTokens(domainTokens).length,
    },
  });

  console.log(
    `claim:lexicon: ${counts.nouns} nouns, ${counts.verbs} verbs, ${counts.adjectives} adjectives, `
    + `${counts.properNames} proper names — ${record.before.toFixed(1)}% OOV out of the box, `
    + `${record.after.toFixed(1)}% OOV on domain prose after \`${LOAD_COMMAND}\` `
    + `(delta ${record.delta >= 0 ? "+" : ""}${record.delta.toFixed(1)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
