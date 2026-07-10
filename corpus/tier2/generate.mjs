#!/usr/bin/env node
// corpus/tier2/generate.mjs — the TIER-2 specialised-corpus generator + manifest
// writer. NOT part of the product path — a maintainer tool. Offline, $0.
//
// Tier-2 corpuses are LANGUAGE- or DOMAIN-specific fact sets (aws, python,
// java, …) that tmct fetches/generates into `.tmct/` at init time so it can
// "expand into a concept for an applicable codebase". They are NOT shipped in
// the npm package the way the tier-1 ConceptNet slice is — they are opt-in,
// selected per repo. See ../README.md for the full tier-1/2/3 policy.
//
// Every tier-2 corpus is written in the EXACT tier-1 fact shape
// (corpus/conceptnet/slice.jsonl): one JSON object per line,
//   {"start":"/c/en/<term>","rel":"/r/<Rel>","end":"/c/en/<concept>","weight":N,"surfaceText":"…"}
// with `rel` drawn ONLY from the mapped relations in
// src/corpus/conceptnet-map.toml, so a tier-2 file loads through the very same
// loadSlice()/toFacts() path as the tier-1 slice (this file's --verify proves
// it). The Wave-2 tier-2 SEEDER (see ../README.md) is what stamps the right
// provenance (`corpus:tier2:<id> /r/…`) instead of the conceptnet default.
//
//   node corpus/tier2/generate.mjs            # (re)write every <id>.jsonl + manifest.json
//   node corpus/tier2/generate.mjs --verify   # generate + assert each file loads & seeds cleanly
//
// To ADD a specialised corpus: add an entry to CORPUSES below (a list of
// [subject, relation, concept] triples, optionally [.., surfaceText]) and
// re-run. Curated sets are authored here so they stay reviewable and diffable;
// a corpus too large to curate by hand is a `fetch` manifest entry instead
// (network, opt-in — see fetchCorpus() and ../README.md).

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// A curated triple is [subject, rel, concept] or [subject, rel, concept, weight].
// `rel` MUST be a mapped (ace != "none") relation in conceptnet-map.toml so the
// fact actually seeds. Terms are lowercase snake_case; the loader's termText()
// turns "/c/en/hash_table" into "hash table". Keep terms <= 3 words (the tier-1
// quality-filter rule) — curated data is clean by construction.
export const CORPUSES = {
  aws: {
    kind: "domain",
    description: "Amazon Web Services core services and primitives (S3, Lambda, DynamoDB, EC2, IAM, SQS) mapped to general cloud/CS concepts.",
    facts: [
      ["aws", "/r/IsA", "cloud_platform"],
      ["aws", "/r/IsA", "cloud"],
      ["aws", "/r/CapableOf", "host_applications"],
      // S3
      ["s3", "/r/IsA", "object_storage"],
      ["s3", "/r/IsA", "storage_service"],
      ["s3", "/r/PartOf", "aws"],
      ["s3", "/r/HasA", "bucket"],
      ["s3", "/r/UsedFor", "storing_files"],
      ["s3", "/r/CapableOf", "store_objects"],
      ["bucket", "/r/IsA", "container"],
      ["bucket", "/r/PartOf", "s3"],
      ["bucket", "/r/UsedFor", "storing_objects"],
      // Lambda
      ["lambda", "/r/IsA", "compute_service"],
      ["lambda", "/r/IsA", "function"],
      ["lambda", "/r/PartOf", "aws"],
      ["lambda", "/r/UsedFor", "running_code"],
      ["lambda", "/r/CapableOf", "run_code"],
      ["lambda", "/r/HasProperty", "serverless"],
      // DynamoDB
      ["dynamodb", "/r/IsA", "database"],
      ["dynamodb", "/r/IsA", "nosql_database"],
      ["dynamodb", "/r/PartOf", "aws"],
      ["dynamodb", "/r/HasA", "table"],
      ["dynamodb", "/r/UsedFor", "storing_data"],
      ["dynamodb", "/r/HasProperty", "managed"],
      // EC2
      ["ec2", "/r/IsA", "compute_service"],
      ["ec2", "/r/IsA", "virtual_machine"],
      ["ec2", "/r/PartOf", "aws"],
      ["ec2", "/r/HasA", "instance"],
      ["ec2", "/r/UsedFor", "running_servers"],
      // IAM
      ["iam", "/r/IsA", "access_control"],
      ["iam", "/r/PartOf", "aws"],
      ["iam", "/r/UsedFor", "managing_permissions"],
      ["iam", "/r/HasA", "role"],
      ["iam", "/r/HasA", "policy"],
      // SQS + queue
      ["sqs", "/r/IsA", "message_queue"],
      ["sqs", "/r/IsA", "queue"],
      ["sqs", "/r/PartOf", "aws"],
      ["sqs", "/r/UsedFor", "decoupling_services"],
      ["queue", "/r/IsA", "data_structure"],
    ],
  },

  python: {
    kind: "language",
    description: "Python language constructs and stdlib types mapped to the shared CS concept vocabulary (list->array, dict->hash table, …).",
    facts: [
      ["python", "/r/IsA", "programming_language"],
      ["python", "/r/HasProperty", "interpreted"],
      ["python", "/r/HasProperty", "dynamically_typed"],
      ["python", "/r/UsedFor", "scripting"],
      // built-in types → shared concepts
      ["list", "/r/IsA", "array"],
      ["list", "/r/IsA", "sequence"],
      ["list", "/r/IsA", "data_structure"],
      ["dict", "/r/IsA", "hash_table"],
      ["dict", "/r/IsA", "dictionary"],
      ["dict", "/r/IsA", "mapping"],
      ["tuple", "/r/IsA", "sequence"],
      ["tuple", "/r/HasProperty", "immutable"],
      ["set", "/r/IsA", "collection"],
      ["set", "/r/HasProperty", "unordered"],
      ["str", "/r/IsA", "string"],
      // language constructs
      ["decorator", "/r/IsA", "function"],
      ["decorator", "/r/UsedFor", "modifying_functions"],
      ["generator", "/r/IsA", "iterator"],
      ["generator", "/r/UsedFor", "lazy_evaluation"],
      ["comprehension", "/r/IsA", "expression"],
      ["comprehension", "/r/UsedFor", "building_collections"],
      ["exception", "/r/IsA", "error"],
      ["module", "/r/IsA", "file"],
      ["package", "/r/IsA", "module"],
      ["method", "/r/IsA", "function"],
      // tooling / runtime
      ["pip", "/r/IsA", "package_manager"],
      ["pip", "/r/UsedFor", "installing_packages"],
      ["gil", "/r/IsA", "lock"],
      ["gil", "/r/PartOf", "interpreter"],
      ["cpython", "/r/IsA", "interpreter"],
    ],
  },

  java: {
    kind: "language",
    description: "Java language and JVM constructs mapped to the shared CS concept vocabulary (ArrayList->list, HashMap->hash table, …).",
    facts: [
      ["java", "/r/IsA", "programming_language"],
      ["java", "/r/HasProperty", "compiled"],
      ["java", "/r/HasProperty", "statically_typed"],
      ["java", "/r/UsedFor", "building_applications"],
      // types → shared concepts
      ["arraylist", "/r/IsA", "list"],
      ["arraylist", "/r/IsA", "data_structure"],
      ["hashmap", "/r/IsA", "hash_table"],
      ["hashmap", "/r/IsA", "dictionary"],
      ["hashmap", "/r/IsA", "map"],
      ["interface", "/r/IsA", "type"],
      ["interface", "/r/IsA", "contract"],
      ["class", "/r/IsA", "type"],
      ["object", "/r/IsA", "instance"],
      // JVM / runtime
      ["jvm", "/r/IsA", "virtual_machine"],
      ["jvm", "/r/UsedFor", "running_bytecode"],
      ["jvm", "/r/CapableOf", "execute_bytecode"],
      ["bytecode", "/r/IsA", "code"],
      ["garbage_collector", "/r/PartOf", "jvm"],
      ["garbage_collector", "/r/UsedFor", "freeing_memory"],
      // packaging / tooling
      ["jar", "/r/IsA", "archive"],
      ["jar", "/r/IsA", "file"],
      ["jar", "/r/UsedFor", "packaging_classes"],
      ["maven", "/r/IsA", "build_tool"],
      ["maven", "/r/IsA", "package_manager"],
      ["gradle", "/r/IsA", "build_tool"],
      // language features
      ["thread", "/r/IsA", "process"],
      ["thread", "/r/UsedFor", "concurrency"],
      ["generics", "/r/UsedFor", "type_safety"],
      ["annotation", "/r/IsA", "metadata"],
      ["exception", "/r/IsA", "error"],
      ["method", "/r/IsA", "function"],
    ],
  },

  // PLAN_AGENTS.md Phase 1's "wider general-knowledge seed set" bullet: the
  // three corpuses above are all code-domain-specific (a LANGUAGE or a cloud
  // DOMAIN); this one deliberately is NOT — everyday-knowledge concepts (the
  // natural world, weather, food, common objects) with zero code-domain
  // framing, proving the extension-pack seam generalizes to a seed set that
  // isn't code at all (the operator's own framing: tmct's code specialization
  // was never a special case, just one seed set among possible others).
  general: {
    kind: "domain",
    description: "General-purpose everyday-knowledge concepts (animals, weather, the natural world, common objects) — a non-code-domain seed set, deliberately outside tmct's own code-domain bias.",
    facts: [
      // animals
      ["dog", "/r/IsA", "mammal"],
      ["dog", "/r/HasA", "tail"],
      ["dog", "/r/CapableOf", "bark"],
      ["cat", "/r/IsA", "mammal"],
      ["cat", "/r/CapableOf", "meow"],
      ["mammal", "/r/IsA", "animal"],
      ["mammal", "/r/HasProperty", "warm_blooded"],
      ["bird", "/r/IsA", "animal"],
      ["bird", "/r/CapableOf", "fly"],
      ["bird", "/r/HasA", "feather"],
      ["fish", "/r/IsA", "animal"],
      ["fish", "/r/AtLocation", "water"],
      ["fish", "/r/CapableOf", "swim"],
      // weather / sky
      ["rain", "/r/IsA", "weather"],
      ["rain", "/r/MadeOf", "water"],
      ["snow", "/r/IsA", "weather"],
      ["snow", "/r/HasProperty", "cold"],
      ["cloud", "/r/PartOf", "sky"],
      ["cloud", "/r/CapableOf", "produce_rain"],
      ["sun", "/r/IsA", "star"],
      ["sun", "/r/CapableOf", "produce_light"],
      ["moon", "/r/AtLocation", "sky"],
      ["moon", "/r/PartOf", "solar_system"],
      ["earth", "/r/IsA", "planet"],
      ["earth", "/r/PartOf", "solar_system"],
      ["planet", "/r/CapableOf", "orbit_a_star"],
      // matter / basic science
      ["water", "/r/IsA", "liquid"],
      ["water", "/r/UsedFor", "drinking"],
      ["ice", "/r/IsA", "solid"],
      ["ice", "/r/MadeOf", "water"],
      ["fire", "/r/CapableOf", "produce_heat"],
      ["fire", "/r/CapableOf", "produce_light"],
      // plants
      ["tree", "/r/IsA", "plant"],
      ["tree", "/r/HasA", "root"],
      ["tree", "/r/HasA", "leaf"],
      ["plant", "/r/CapableOf", "photosynthesize"],
      ["forest", "/r/HasA", "tree"],
      // everyday objects / places
      ["kitchen", "/r/PartOf", "house"],
      ["kitchen", "/r/UsedFor", "cooking"],
      ["bread", "/r/IsA", "food"],
      ["bread", "/r/MadeOf", "flour"],
      ["bicycle", "/r/HasA", "wheel"],
      ["bicycle", "/r/UsedFor", "transportation"],
      ["car", "/r/IsA", "vehicle"],
      ["car", "/r/HasA", "engine"],
      ["engine", "/r/CapableOf", "produce_power"],
      ["book", "/r/MadeOf", "paper"],
      ["book", "/r/UsedFor", "reading"],
      ["clock", "/r/UsedFor", "telling_time"],
    ],
  },

  // PLAN_SEED.md — the default "human-world" persona (the operator's own
  // framing: SEON+ConceptNet's code-domain bias was never the only sensible
  // default; this is the general-knowledge seed set that REPLACES it as the
  // default active bundle, per src/extensions.mjs's builtinExtensions()).
  // Hand-curated from two locally-cloned reference sources
  // (scripts/extract-persona-sources.mjs's worksheet — never a mechanical
  // dump of either): Open English WordNet (CC-BY-4.0, Princeton WordNet +
  // Open English WordNet team) supplies the 8 content clumps' common-word
  // IsA/HasA/UsedFor/CapableOf/etc. facts; Schema.org's vocabulary
  // (Apache-2.0) supplies `human-base`'s top-level category classes and
  // `human-bridge`'s showcase connection between the two independently-built
  // taxonomies (PLAN_SEED.md §8) — both hand-authored in homage to their
  // source's real class shape, never copied verbatim (SEON's own
  // LICENSE-NOTICE discipline). 9 clumps, Small tier (PLAN_SEED.md §3):
  // human-base (scaffolding, always first), 7 content clumps, human-bridge
  // (the cross-ontology showcase). "Breadth over depth" throughout, per the
  // operator's explicit instruction — flat one-hop IsA facts, no gender/
  // kinship taxonomy, no formal role hierarchy.
  human: {
    kind: "domain",
    description: "The default human-world persona (PLAN_SEED.md): everyday people, places, objects, nature, time/events, body/food and mind vocabulary, hand-curated from Open English WordNet (CC-BY-4.0) and bridged to Schema.org's (Apache-2.0) top-level classes — replaces the code-domain SEON+ConceptNet default.",
    // Every noun/verb/adjective this corpus's facts depend on, so a live
    // sentence built from the SAME curated vocabulary ("a man has a hat") can
    // actually parse — src/grammar/lexicon-core.json carries the real
    // entries (PLAN_SEED.md §4's "two vocabulary surfaces", gated
    // independently); this list is the --verify drift-guard's source of
    // truth (below), not a second copy of the lexicon file itself.
    lexicon: {
      nouns: [
        // human-core
        "man", "woman", "person", "child", "boy", "girl", "baby", "adult",
        "friend", "neighbor", "stranger", "guest", "doctor", "teacher",
        "nurse", "student", "farmer", "mother", "father", "brother",
        "sister", "family", "king", "queen", "soldier", "artist", "writer",
        "cook", "group", "crowd", "audience", "club", "president", "human",
        "lawyer", "engineer", "driver", "manager", "officer", "judge",
        "priest", "servant", "employee", "boss", "husband", "wife", "son",
        "daughter", "grandmother", "grandfather", "citizen", "customer",
        "leader", "champion", "volunteer", "resident",
        // human-places
        "place", "city", "town", "village", "country", "house", "home",
        "room", "kitchen", "bedroom", "bathroom", "school", "hospital",
        "shop", "market", "church", "park", "garden", "street", "road",
        "bridge", "farm", "office", "factory", "library", "museum", "hotel",
        "airport", "castle", "beach", "forest", "mountain",
        // human-objects
        "hat", "shirt", "coat", "shoe", "dress", "clothing", "table",
        "chair", "bed", "door", "window", "wall", "roof", "pen", "paper",
        "key", "lock", "box", "car", "bicycle", "boat", "train", "wheel",
        "knife", "spoon", "fork", "plate", "cup", "bottle", "bag", "money",
        "coin", "toy", "tool", "machine", "clock", "phone", "book", "letter",
        "umbrella", "glove", "sock", "ring", "watch", "mirror", "candle",
        "ladder", "hammer", "basket", "wallet",
        // human-nature
        "dog", "cat", "horse", "cow", "pig", "sheep", "bird", "fish",
        "mouse", "rabbit", "bear", "lion", "tiger", "elephant", "snake",
        "tree", "flower", "grass", "leaf", "root", "seed", "fruit", "water",
        "air", "fire", "earth", "stone", "sand", "gold", "iron", "rain",
        "snow", "wind", "cloud", "sun", "moon", "star", "owl", "wolf",
        "frog", "bee", "ant", "butterfly", "spider", "river", "ocean",
        // human-time-events
        "time", "day", "night", "morning", "evening", "week", "month",
        "year", "hour", "minute", "second", "moment", "season", "spring",
        "summer", "winter", "wedding", "race", "dozen", "half", "amount",
        "meeting", "game", "war", "trip", "birthday", "holiday", "autumn",
        "century",
        // human-body-food
        "body", "head", "hand", "arm", "leg", "foot", "eye", "ear", "mouth",
        "nose", "hair", "heart", "blood", "bone", "skin", "face", "food",
        "bread", "meat", "milk", "egg", "cheese", "vegetable", "meal",
        "breakfast", "dinner", "drink", "wine", "tea", "coffee", "tongue",
        "tooth", "finger", "toe", "shoulder", "knee", "brain", "lung",
        "sugar", "salt",
        // human-mind
        "word", "story", "news", "idea", "thought", "mind", "memory",
        "dream", "belief", "love", "hate", "fear", "joy", "anger", "hope",
        "surprise", "pride", "song", "music", "sound", "voice", "picture",
        "art", "knowledge", "opinion", "reason", "imagination", "laughter",
        "tear", "smile", "silence",
        // human-bridge (WordNet-side anchors; "language"/"question"/
        // "answer"/"event"/"number"/"parent"/"tool"/"team"/"visitor"/
        // "worker"/"engineer"/"table" already exist as software-domain
        // nouns — reused, not redeclared)
        "object", "artifact", "location", "quantity", "organization",
        // category-root nouns used as a hypernym TARGET by several facts
        // above (e.g. "dog IsA animal") — declared directly too, since a
        // hypernym root is exactly the kind of word someone would plausibly
        // ask or teach about on its own ("what is an animal").
        "animal", "plant", "furniture", "vehicle", "insect", "emotion",
        "metal", "liquid", "weather", "planet", "jewelry", "cutlery",
        "government", "material",
      ],
      verbs: [
        "like", "want", "need", "believe", "trust", "love", "hate", "fear",
        "hope", "own", "teach", "learn", "build", "drive", "cook", "sing",
        "visit", "care", "grow", "marry", "wear", "eat", "sleep", "walk",
        "buy", "sell", "give", "take", "meet", "ride", "speak", "watch",
      ],
      adjectives: [
        "male", "female", "young", "old", "hot", "cold", "sweet", "salty",
        "sharp", "round", "tall", "short", "happy", "sad", "angry",
        "afraid", "strong", "weak", "rich", "poor", "hard", "soft", "wild",
        "gentle", "colorful",
      ],
      properNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    },
    facts: [
      // ---- human-base (scaffolding, ~18 facts) — the top-level category
      // classes, `rdfs:subClassOf` children of a "schema thing" concept
      // representing Schema.org's real `:Thing` root (hand-authored in
      // homage to schema.org/Thing's shape — PLAN_SEED.md §5 — never a
      // verbatim copy of Schema.org's own class definitions/comments).
      // Always active regardless of tier (PLAN_SEED.md §3).
      ["schema_person", "/r/IsA", "schema_thing"],
      ["schema_place", "/r/IsA", "schema_thing"],
      ["schema_object", "/r/IsA", "schema_thing"],
      ["schema_event", "/r/IsA", "schema_thing"],
      ["schema_time", "/r/IsA", "schema_thing"],
      ["schema_quantity", "/r/IsA", "schema_thing"],
      ["schema_organization", "/r/IsA", "schema_thing"],
      ["schema_event", "/r/AtLocation", "schema_place"],
      ["schema_organization", "/r/HasA", "schema_person"],
      ["schema_person", "/r/AtLocation", "schema_place"],
      ["schema_object", "/r/AtLocation", "schema_place"],
      ["schema_event", "/r/HasA", "schema_time"],
      ["schema_organization", "/r/UsedFor", "organizing_people"],
      ["schema_quantity", "/r/UsedFor", "measuring"],
      ["schema_time", "/r/UsedFor", "scheduling_events"],
      ["schema_place", "/r/HasProperty", "physical"],
      ["schema_object", "/r/HasProperty", "ownable"],
      ["schema_event", "/r/HasProperty", "temporary"],

      // ---- human-core (people, family, common roles — ~150 facts) ----
      ["man", "/r/IsA", "person"], ["man", "/r/HasProperty", "male"],
      ["woman", "/r/IsA", "person"], ["woman", "/r/HasProperty", "female"],
      ["person", "/r/CapableOf", "think"], ["person", "/r/CapableOf", "speak"], ["person", "/r/Desires", "happiness"],
      ["child", "/r/IsA", "person"], ["child", "/r/HasProperty", "young"],
      ["boy", "/r/IsA", "child"], ["boy", "/r/HasProperty", "male"],
      ["girl", "/r/IsA", "child"], ["girl", "/r/HasProperty", "female"],
      ["baby", "/r/IsA", "child"], ["baby", "/r/HasProperty", "young"],
      ["adult", "/r/IsA", "person"], ["adult", "/r/HasProperty", "grown"],
      ["friend", "/r/IsA", "person"], ["friend", "/r/CapableOf", "help"], ["friend", "/r/Desires", "trust"],
      ["neighbor", "/r/IsA", "person"], ["neighbor", "/r/AtLocation", "nearby_house"],
      ["stranger", "/r/IsA", "person"], ["stranger", "/r/HasProperty", "unknown"],
      ["guest", "/r/IsA", "person"], ["guest", "/r/AtLocation", "house"],
      ["visitor", "/r/IsA", "person"], ["visitor", "/r/CapableOf", "visit"],
      ["doctor", "/r/IsA", "person"], ["doctor", "/r/UsedFor", "treating_illness"], ["doctor", "/r/CapableOf", "treat_patients"], ["doctor", "/r/AtLocation", "hospital"],
      ["teacher", "/r/IsA", "person"], ["teacher", "/r/UsedFor", "teaching"], ["teacher", "/r/CapableOf", "teach"], ["teacher", "/r/AtLocation", "school"],
      ["nurse", "/r/IsA", "person"], ["nurse", "/r/UsedFor", "caring_for_patients"], ["nurse", "/r/AtLocation", "hospital"],
      ["student", "/r/IsA", "person"], ["student", "/r/CapableOf", "learn"], ["student", "/r/AtLocation", "school"],
      ["worker", "/r/IsA", "person"], ["worker", "/r/CapableOf", "work"], ["worker", "/r/AtLocation", "workplace"],
      ["farmer", "/r/IsA", "person"], ["farmer", "/r/CapableOf", "farm"], ["farmer", "/r/AtLocation", "farm"],
      ["mother", "/r/IsA", "parent"], ["mother", "/r/HasProperty", "female"],
      ["father", "/r/IsA", "parent"], ["father", "/r/HasProperty", "male"],
      ["parent", "/r/IsA", "person"], ["parent", "/r/CapableOf", "care_for_a_child"],
      ["brother", "/r/IsA", "person"], ["brother", "/r/HasProperty", "male"], ["brother", "/r/PartOf", "family"],
      ["sister", "/r/IsA", "person"], ["sister", "/r/HasProperty", "female"], ["sister", "/r/PartOf", "family"],
      ["family", "/r/IsA", "group"], ["family", "/r/HasA", "parent"], ["family", "/r/HasA", "child"],
      ["king", "/r/IsA", "person"], ["king", "/r/CapableOf", "rule"], ["king", "/r/AtLocation", "kingdom"],
      ["queen", "/r/IsA", "person"], ["queen", "/r/CapableOf", "rule"], ["queen", "/r/AtLocation", "kingdom"],
      ["soldier", "/r/IsA", "person"], ["soldier", "/r/CapableOf", "fight"], ["soldier", "/r/UsedFor", "defending_a_country"],
      ["artist", "/r/IsA", "person"], ["artist", "/r/CapableOf", "create_art"],
      ["writer", "/r/IsA", "person"], ["writer", "/r/CapableOf", "write"],
      ["cook", "/r/IsA", "person"], ["cook", "/r/CapableOf", "cook"], ["cook", "/r/AtLocation", "kitchen"],
      ["team", "/r/IsA", "group"], ["team", "/r/HasA", "player"], ["team", "/r/UsedFor", "playing_a_game"],
      ["group", "/r/HasA", "person"], ["group", "/r/CapableOf", "work_together"],
      ["crowd", "/r/IsA", "group"], ["crowd", "/r/HasProperty", "large"],
      ["audience", "/r/IsA", "group"], ["audience", "/r/CapableOf", "watch"],
      ["club", "/r/IsA", "group"], ["club", "/r/UsedFor", "meeting_together"],
      ["president", "/r/IsA", "person"], ["president", "/r/CapableOf", "lead"], ["president", "/r/AtLocation", "country"],
      ["human", "/r/IsA", "person"],
      ["lawyer", "/r/IsA", "person"], ["lawyer", "/r/CapableOf", "give_legal_advice"], ["lawyer", "/r/AtLocation", "office"],
      ["engineer", "/r/IsA", "person"], ["engineer", "/r/CapableOf", "build_things"], ["engineer", "/r/AtLocation", "office"],
      ["driver", "/r/IsA", "person"], ["driver", "/r/CapableOf", "drive"], ["driver", "/r/UsedFor", "transporting_people"],
      ["manager", "/r/IsA", "person"], ["manager", "/r/CapableOf", "manage_a_team"],
      ["officer", "/r/IsA", "person"], ["officer", "/r/CapableOf", "enforce_law"],
      ["judge", "/r/IsA", "person"], ["judge", "/r/CapableOf", "judge_a_case"], ["judge", "/r/AtLocation", "court"],
      ["priest", "/r/IsA", "person"], ["priest", "/r/CapableOf", "lead_worship"], ["priest", "/r/AtLocation", "church"],
      ["servant", "/r/IsA", "person"], ["servant", "/r/CapableOf", "serve"],
      ["employee", "/r/IsA", "worker"], ["employee", "/r/CapableOf", "work_for_a_company"],
      ["boss", "/r/IsA", "person"], ["boss", "/r/CapableOf", "manage_employees"],
      ["husband", "/r/IsA", "person"], ["husband", "/r/HasProperty", "married"], ["husband", "/r/HasProperty", "male"],
      ["wife", "/r/IsA", "person"], ["wife", "/r/HasProperty", "married"], ["wife", "/r/HasProperty", "female"],
      ["son", "/r/IsA", "child"], ["son", "/r/HasProperty", "male"],
      ["daughter", "/r/IsA", "child"], ["daughter", "/r/HasProperty", "female"],
      ["grandmother", "/r/IsA", "person"], ["grandmother", "/r/PartOf", "family"], ["grandmother", "/r/HasProperty", "female"],
      ["grandfather", "/r/IsA", "person"], ["grandfather", "/r/PartOf", "family"], ["grandfather", "/r/HasProperty", "male"],
      ["citizen", "/r/IsA", "person"], ["citizen", "/r/PartOf", "country"],
      ["customer", "/r/IsA", "person"], ["customer", "/r/CapableOf", "buy_things"],
      ["leader", "/r/IsA", "person"], ["leader", "/r/CapableOf", "lead"],
      ["champion", "/r/IsA", "person"], ["champion", "/r/CapableOf", "win"],
      ["volunteer", "/r/IsA", "person"], ["volunteer", "/r/CapableOf", "help_without_pay"],
      ["resident", "/r/IsA", "person"], ["resident", "/r/AtLocation", "house"],

      // ---- human-places (~80 facts) ----
      ["place", "/r/HasProperty", "physical"], ["place", "/r/CapableOf", "contain_things"],
      ["city", "/r/IsA", "place"], ["city", "/r/HasA", "building"], ["city", "/r/HasA", "street"],
      ["town", "/r/IsA", "place"], ["town", "/r/HasProperty", "small"],
      ["village", "/r/IsA", "place"], ["village", "/r/HasProperty", "small"],
      ["country", "/r/IsA", "place"], ["country", "/r/HasA", "city"], ["country", "/r/HasA", "government"],
      ["house", "/r/IsA", "place"], ["house", "/r/PartOf", "city"], ["house", "/r/HasA", "room"],
      ["home", "/r/IsA", "house"], ["home", "/r/HasProperty", "comfortable"],
      ["room", "/r/IsA", "place"], ["room", "/r/PartOf", "house"],
      ["kitchen", "/r/IsA", "room"], ["kitchen", "/r/UsedFor", "cooking"],
      ["bedroom", "/r/IsA", "room"], ["bedroom", "/r/UsedFor", "sleeping"],
      ["bathroom", "/r/IsA", "room"], ["bathroom", "/r/UsedFor", "washing"],
      ["school", "/r/IsA", "place"], ["school", "/r/UsedFor", "teaching"], ["school", "/r/HasA", "teacher"],
      ["hospital", "/r/IsA", "place"], ["hospital", "/r/UsedFor", "treating_illness"], ["hospital", "/r/HasA", "doctor"],
      ["shop", "/r/IsA", "place"], ["shop", "/r/UsedFor", "selling_goods"],
      ["market", "/r/IsA", "place"], ["market", "/r/UsedFor", "selling_goods"],
      ["church", "/r/IsA", "place"], ["church", "/r/UsedFor", "worship"],
      ["park", "/r/IsA", "place"], ["park", "/r/HasA", "tree"], ["park", "/r/UsedFor", "playing"],
      ["garden", "/r/IsA", "place"], ["garden", "/r/HasA", "flower"], ["garden", "/r/UsedFor", "growing_plants"],
      ["street", "/r/IsA", "place"], ["street", "/r/PartOf", "city"], ["street", "/r/HasA", "car"],
      ["road", "/r/IsA", "place"], ["road", "/r/UsedFor", "traveling"],
      ["bridge", "/r/IsA", "structure"], ["bridge", "/r/UsedFor", "crossing_a_river"],
      ["farm", "/r/IsA", "place"], ["farm", "/r/UsedFor", "growing_food"], ["farm", "/r/HasA", "farmer"],
      ["office", "/r/IsA", "place"], ["office", "/r/UsedFor", "working"],
      ["factory", "/r/IsA", "place"], ["factory", "/r/UsedFor", "making_goods"],
      ["library", "/r/IsA", "place"], ["library", "/r/HasA", "book"], ["library", "/r/UsedFor", "reading"],
      ["museum", "/r/IsA", "place"], ["museum", "/r/HasA", "artifact"], ["museum", "/r/UsedFor", "learning"],
      ["hotel", "/r/IsA", "place"], ["hotel", "/r/UsedFor", "sleeping"],
      ["airport", "/r/IsA", "place"], ["airport", "/r/UsedFor", "traveling_by_plane"],
      ["stadium", "/r/IsA", "place"], ["stadium", "/r/UsedFor", "playing_a_game"],
      ["court", "/r/IsA", "place"], ["court", "/r/UsedFor", "judging_a_case"],
      ["castle", "/r/IsA", "place"], ["castle", "/r/HasProperty", "old"], ["castle", "/r/UsedFor", "defense"],
      ["beach", "/r/IsA", "place"], ["beach", "/r/HasA", "sand"],
      ["forest", "/r/IsA", "place"], ["forest", "/r/HasA", "tree"],
      ["mountain", "/r/IsA", "place"], ["mountain", "/r/HasProperty", "tall"],

      // ---- human-objects (~100 facts) ----
      ["hat", "/r/IsA", "clothing"], ["hat", "/r/UsedFor", "covering_the_head"],
      ["shirt", "/r/IsA", "clothing"], ["shirt", "/r/PartOf", "outfit"],
      ["coat", "/r/IsA", "clothing"], ["coat", "/r/UsedFor", "keeping_warm"],
      ["shoe", "/r/IsA", "clothing"], ["shoe", "/r/PartOf", "outfit"],
      ["dress", "/r/IsA", "clothing"], ["dress", "/r/HasProperty", "female"],
      ["clothing", "/r/HasProperty", "wearable"], ["clothing", "/r/UsedFor", "covering_the_body"],
      ["table", "/r/IsA", "furniture"], ["table", "/r/UsedFor", "holding_things"],
      ["chair", "/r/IsA", "furniture"], ["chair", "/r/UsedFor", "sitting"],
      ["bed", "/r/IsA", "furniture"], ["bed", "/r/UsedFor", "sleeping"],
      ["door", "/r/PartOf", "house"], ["door", "/r/UsedFor", "entering_a_room"],
      ["window", "/r/PartOf", "house"], ["window", "/r/UsedFor", "letting_in_light"],
      ["wall", "/r/PartOf", "house"], ["wall", "/r/UsedFor", "dividing_rooms"],
      ["roof", "/r/PartOf", "house"], ["roof", "/r/UsedFor", "covering_a_building"],
      ["pen", "/r/UsedFor", "writing"], ["pen", "/r/MadeOf", "plastic"],
      ["paper", "/r/UsedFor", "writing"], ["paper", "/r/MadeOf", "wood"],
      ["key", "/r/UsedFor", "opening_a_lock"], ["key", "/r/PartOf", "lock_and_key"],
      ["lock", "/r/UsedFor", "securing_a_door"], ["lock", "/r/HasA", "key"],
      ["box", "/r/UsedFor", "storing_things"], ["box", "/r/MadeOf", "cardboard"],
      ["car", "/r/IsA", "vehicle"], ["car", "/r/HasA", "wheel"], ["car", "/r/UsedFor", "traveling"],
      ["bicycle", "/r/IsA", "vehicle"], ["bicycle", "/r/HasA", "wheel"], ["bicycle", "/r/CapableOf", "carry_a_person"],
      ["boat", "/r/IsA", "vehicle"], ["boat", "/r/UsedFor", "traveling_on_water"],
      ["train", "/r/IsA", "vehicle"], ["train", "/r/UsedFor", "traveling"], ["train", "/r/HasA", "wheel"],
      ["wheel", "/r/PartOf", "vehicle"], ["wheel", "/r/HasProperty", "round"],
      ["knife", "/r/UsedFor", "cutting"], ["knife", "/r/HasProperty", "sharp"],
      ["spoon", "/r/UsedFor", "eating"], ["spoon", "/r/PartOf", "cutlery"],
      ["fork", "/r/UsedFor", "eating"], ["fork", "/r/PartOf", "cutlery"],
      ["plate", "/r/UsedFor", "holding_food"], ["plate", "/r/MadeOf", "ceramic"],
      ["cup", "/r/UsedFor", "drinking"], ["cup", "/r/MadeOf", "ceramic"],
      ["bottle", "/r/UsedFor", "storing_liquid"], ["bottle", "/r/MadeOf", "glass"],
      ["bag", "/r/UsedFor", "carrying_things"], ["bag", "/r/HasA", "handle"],
      ["money", "/r/UsedFor", "buying_things"], ["money", "/r/HasProperty", "valuable"],
      ["coin", "/r/IsA", "money"], ["coin", "/r/MadeOf", "metal"],
      ["toy", "/r/UsedFor", "playing"], ["toy", "/r/CapableOf", "entertain_a_child"],
      ["tool", "/r/UsedFor", "working"], ["tool", "/r/CapableOf", "help_build_things"],
      ["machine", "/r/CapableOf", "do_work"], ["machine", "/r/HasProperty", "mechanical"],
      ["clock", "/r/UsedFor", "telling_time"], ["clock", "/r/HasA", "hand"],
      ["phone", "/r/UsedFor", "communicating"], ["phone", "/r/CapableOf", "make_calls"],
      ["book", "/r/MadeOf", "paper"], ["book", "/r/UsedFor", "reading"],
      ["letter", "/r/MadeOf", "paper"], ["letter", "/r/UsedFor", "communicating"],
      ["umbrella", "/r/UsedFor", "staying_dry"], ["umbrella", "/r/CapableOf", "block_rain"],
      ["glove", "/r/IsA", "clothing"], ["glove", "/r/UsedFor", "covering_the_hand"],
      ["sock", "/r/IsA", "clothing"], ["sock", "/r/PartOf", "outfit"],
      ["ring", "/r/IsA", "jewelry"], ["ring", "/r/MadeOf", "gold"],
      ["watch", "/r/UsedFor", "telling_time"], ["watch", "/r/PartOf", "jewelry"],
      ["mirror", "/r/UsedFor", "seeing_your_reflection"], ["mirror", "/r/MadeOf", "glass"],
      ["candle", "/r/UsedFor", "giving_light"], ["candle", "/r/MadeOf", "wax"],
      ["ladder", "/r/UsedFor", "climbing"], ["ladder", "/r/MadeOf", "wood"],
      ["hammer", "/r/UsedFor", "hitting_nails"], ["hammer", "/r/PartOf", "toolbox"],
      ["basket", "/r/UsedFor", "carrying_things"], ["basket", "/r/MadeOf", "woven_material"],
      ["wallet", "/r/UsedFor", "carrying_money"], ["wallet", "/r/PartOf", "outfit"],

      // ---- human-nature (~100 facts) ----
      ["dog", "/r/IsA", "animal"], ["dog", "/r/HasA", "tail"], ["dog", "/r/CapableOf", "bark"],
      ["cat", "/r/IsA", "animal"], ["cat", "/r/CapableOf", "meow"], ["cat", "/r/HasA", "fur"],
      ["horse", "/r/IsA", "animal"], ["horse", "/r/CapableOf", "run"], ["horse", "/r/UsedFor", "riding"],
      ["cow", "/r/IsA", "animal"], ["cow", "/r/UsedFor", "producing_milk"],
      ["pig", "/r/IsA", "animal"], ["pig", "/r/HasProperty", "pink"],
      ["sheep", "/r/IsA", "animal"], ["sheep", "/r/HasA", "wool"],
      ["bird", "/r/IsA", "animal"], ["bird", "/r/HasA", "feather"], ["bird", "/r/CapableOf", "fly"],
      ["fish", "/r/IsA", "animal"], ["fish", "/r/AtLocation", "water"], ["fish", "/r/CapableOf", "swim"],
      ["mouse", "/r/IsA", "animal"], ["mouse", "/r/HasProperty", "small"],
      ["rabbit", "/r/IsA", "animal"], ["rabbit", "/r/CapableOf", "hop"],
      ["bear", "/r/IsA", "animal"], ["bear", "/r/HasProperty", "large"],
      ["lion", "/r/IsA", "animal"], ["lion", "/r/CapableOf", "roar"],
      ["tiger", "/r/IsA", "animal"], ["tiger", "/r/HasProperty", "striped"],
      ["elephant", "/r/IsA", "animal"], ["elephant", "/r/HasProperty", "large"], ["elephant", "/r/HasA", "trunk"],
      ["snake", "/r/IsA", "animal"], ["snake", "/r/HasProperty", "legless"],
      ["tree", "/r/IsA", "plant"], ["tree", "/r/HasA", "leaf"], ["tree", "/r/HasA", "root"],
      ["flower", "/r/IsA", "plant"], ["flower", "/r/HasProperty", "colorful"],
      ["grass", "/r/IsA", "plant"], ["grass", "/r/AtLocation", "ground"],
      ["leaf", "/r/PartOf", "plant"], ["leaf", "/r/CapableOf", "photosynthesize"],
      ["root", "/r/PartOf", "plant"], ["root", "/r/AtLocation", "underground"],
      ["seed", "/r/PartOf", "plant"], ["seed", "/r/CapableOf", "grow_into_a_plant"],
      ["fruit", "/r/PartOf", "plant"], ["fruit", "/r/UsedFor", "eating"],
      ["water", "/r/IsA", "liquid"], ["water", "/r/UsedFor", "drinking"],
      ["air", "/r/UsedFor", "breathing"], ["air", "/r/AtLocation", "sky"],
      ["fire", "/r/CapableOf", "produce_heat"], ["fire", "/r/CapableOf", "produce_light"],
      ["earth", "/r/IsA", "planet"], ["earth", "/r/HasA", "ocean"],
      ["stone", "/r/IsA", "material"], ["stone", "/r/HasProperty", "hard"],
      ["sand", "/r/AtLocation", "beach"], ["sand", "/r/HasProperty", "small"],
      ["gold", "/r/IsA", "metal"], ["gold", "/r/HasProperty", "valuable"],
      ["iron", "/r/IsA", "metal"], ["iron", "/r/HasProperty", "strong"],
      ["rain", "/r/IsA", "weather"], ["rain", "/r/MadeOf", "water"],
      ["snow", "/r/IsA", "weather"], ["snow", "/r/HasProperty", "cold"],
      ["wind", "/r/CapableOf", "move_things"], ["wind", "/r/AtLocation", "sky"],
      ["cloud", "/r/PartOf", "sky"], ["cloud", "/r/CapableOf", "produce_rain"],
      ["sun", "/r/IsA", "star"], ["sun", "/r/CapableOf", "produce_light"],
      ["moon", "/r/AtLocation", "sky"], ["moon", "/r/CapableOf", "orbit_the_earth"],
      ["star", "/r/AtLocation", "sky"], ["star", "/r/CapableOf", "produce_light"],
      ["owl", "/r/IsA", "bird"], ["owl", "/r/CapableOf", "hunt_at_night"],
      ["wolf", "/r/IsA", "animal"], ["wolf", "/r/CapableOf", "hunt_in_packs"],
      ["frog", "/r/IsA", "animal"], ["frog", "/r/CapableOf", "jump"],
      ["bee", "/r/IsA", "insect"], ["bee", "/r/CapableOf", "make_honey"],
      ["ant", "/r/IsA", "insect"],
      ["butterfly", "/r/IsA", "insect"], ["butterfly", "/r/HasProperty", "colorful"],
      ["spider", "/r/IsA", "animal"], ["spider", "/r/HasA", "leg"],
      ["river", "/r/IsA", "waterway"], ["river", "/r/CapableOf", "flow"],
      ["ocean", "/r/IsA", "body_of_water"], ["ocean", "/r/HasProperty", "salty"],

      // ---- human-time-events (~60 facts) ----
      ["time", "/r/HasProperty", "measurable"], ["time", "/r/CapableOf", "pass"],
      ["day", "/r/PartOf", "week"], ["day", "/r/HasA", "morning"],
      ["night", "/r/PartOf", "day"], ["night", "/r/HasProperty", "dark"],
      ["morning", "/r/PartOf", "day"], ["morning", "/r/HasProperty", "early"],
      ["evening", "/r/PartOf", "day"], ["evening", "/r/HasProperty", "late"],
      ["week", "/r/PartOf", "month"], ["week", "/r/HasA", "day"],
      ["month", "/r/PartOf", "year"], ["month", "/r/HasA", "week"],
      ["year", "/r/HasA", "month"], ["year", "/r/HasA", "season"],
      ["hour", "/r/PartOf", "day"], ["hour", "/r/HasA", "minute"],
      ["minute", "/r/PartOf", "hour"], ["minute", "/r/HasA", "second"],
      ["second", "/r/PartOf", "minute"], ["second", "/r/HasProperty", "brief"],
      ["moment", "/r/HasProperty", "brief"], ["moment", "/r/IsA", "time"],
      ["season", "/r/PartOf", "year"], ["season", "/r/HasProperty", "recurring"],
      ["spring", "/r/IsA", "season"], ["spring", "/r/HasProperty", "warm"],
      ["summer", "/r/IsA", "season"], ["summer", "/r/HasProperty", "hot"],
      ["winter", "/r/IsA", "season"], ["winter", "/r/HasProperty", "cold"],
      ["wedding", "/r/IsA", "event"], ["wedding", "/r/HasA", "family"],
      ["race", "/r/IsA", "event"], ["race", "/r/CapableOf", "determine_a_winner"],
      ["dozen", "/r/IsA", "number"], ["dozen", "/r/HasProperty", "twelve"],
      ["half", "/r/IsA", "quantity"], ["half", "/r/HasProperty", "fractional"],
      ["amount", "/r/IsA", "quantity"], ["amount", "/r/UsedFor", "measuring"],
      ["meeting", "/r/IsA", "event"], ["meeting", "/r/UsedFor", "discussing_ideas"],
      ["game", "/r/IsA", "event"], ["game", "/r/CapableOf", "entertain_people"],
      ["war", "/r/IsA", "event"], ["war", "/r/CapableOf", "cause_death"],
      ["trip", "/r/IsA", "event"], ["trip", "/r/UsedFor", "traveling"],
      ["birthday", "/r/IsA", "event"], ["birthday", "/r/PartOf", "year"],
      ["holiday", "/r/IsA", "event"], ["holiday", "/r/HasProperty", "festive"],
      ["autumn", "/r/IsA", "season"], ["autumn", "/r/HasProperty", "cool"],
      ["century", "/r/HasA", "year"], ["century", "/r/HasProperty", "long"],

      // ---- human-body-food (~80 facts) ----
      ["body", "/r/HasA", "head"], ["body", "/r/HasA", "arm"], ["body", "/r/HasA", "leg"],
      ["head", "/r/PartOf", "body"], ["head", "/r/HasA", "eye"],
      ["hand", "/r/PartOf", "arm"], ["hand", "/r/UsedFor", "holding_things"],
      ["arm", "/r/PartOf", "body"], ["arm", "/r/HasA", "hand"],
      ["leg", "/r/PartOf", "body"], ["leg", "/r/HasA", "foot"],
      ["foot", "/r/PartOf", "leg"], ["foot", "/r/UsedFor", "walking"],
      ["eye", "/r/PartOf", "face"], ["eye", "/r/UsedFor", "seeing"],
      ["ear", "/r/PartOf", "head"], ["ear", "/r/UsedFor", "hearing"],
      ["mouth", "/r/PartOf", "face"], ["mouth", "/r/UsedFor", "eating"],
      ["nose", "/r/PartOf", "face"], ["nose", "/r/UsedFor", "smelling"],
      ["hair", "/r/PartOf", "head"], ["hair", "/r/HasProperty", "growing"],
      ["heart", "/r/PartOf", "body"], ["heart", "/r/CapableOf", "pump_blood"],
      ["blood", "/r/PartOf", "body"], ["blood", "/r/HasProperty", "red"],
      ["bone", "/r/PartOf", "body"], ["bone", "/r/HasProperty", "hard"],
      ["skin", "/r/PartOf", "body"], ["skin", "/r/UsedFor", "protecting_the_body"],
      ["face", "/r/PartOf", "head"], ["face", "/r/HasA", "eye"],
      ["food", "/r/UsedFor", "eating"], ["food", "/r/CapableOf", "provide_energy"],
      ["bread", "/r/IsA", "food"], ["bread", "/r/MadeOf", "flour"],
      ["meat", "/r/IsA", "food"], ["meat", "/r/MadeOf", "animal_flesh"],
      ["milk", "/r/CapableOf", "provide_calcium"], ["milk", "/r/AtLocation", "cow"],
      ["egg", "/r/IsA", "food"], ["egg", "/r/AtLocation", "chicken"],
      ["cheese", "/r/IsA", "food"], ["cheese", "/r/MadeOf", "milk"],
      ["vegetable", "/r/IsA", "food"], ["vegetable", "/r/AtLocation", "garden"],
      ["meal", "/r/HasA", "food"], ["meal", "/r/AtLocation", "table"],
      ["breakfast", "/r/IsA", "meal"], ["breakfast", "/r/AtLocation", "morning"],
      ["dinner", "/r/IsA", "meal"], ["dinner", "/r/AtLocation", "evening"],
      ["drink", "/r/UsedFor", "drinking"], ["drink", "/r/CapableOf", "quench_thirst"],
      ["wine", "/r/IsA", "drink"], ["wine", "/r/MadeOf", "grape"],
      ["tea", "/r/IsA", "drink"], ["tea", "/r/MadeOf", "leaf"],
      ["coffee", "/r/IsA", "drink"], ["coffee", "/r/MadeOf", "bean"],
      ["tongue", "/r/PartOf", "mouth"], ["tongue", "/r/UsedFor", "tasting"],
      ["tooth", "/r/PartOf", "mouth"], ["tooth", "/r/UsedFor", "chewing"],
      ["finger", "/r/PartOf", "hand"], ["finger", "/r/UsedFor", "grabbing_things"],
      ["toe", "/r/PartOf", "foot"],
      ["shoulder", "/r/PartOf", "arm"], ["shoulder", "/r/PartOf", "body"],
      ["knee", "/r/PartOf", "leg"], ["knee", "/r/CapableOf", "bend"],
      ["brain", "/r/PartOf", "head"], ["brain", "/r/CapableOf", "think"],
      ["lung", "/r/PartOf", "body"], ["lung", "/r/UsedFor", "breathing"],
      ["sugar", "/r/IsA", "food"], ["sugar", "/r/HasProperty", "sweet"],
      ["salt", "/r/IsA", "food"], ["salt", "/r/HasProperty", "salty"],

      // ---- human-mind (~70 facts) ----
      ["word", "/r/PartOf", "language"], ["word", "/r/UsedFor", "communicating"],
      ["language", "/r/UsedFor", "communicating"], ["language", "/r/HasA", "word"],
      ["story", "/r/UsedFor", "entertaining"], ["story", "/r/HasA", "character"],
      ["news", "/r/UsedFor", "informing_people"], ["news", "/r/AtLocation", "newspaper"],
      ["question", "/r/UsedFor", "asking"], ["question", "/r/Desires", "an_answer"],
      ["answer", "/r/UsedFor", "answering_a_question"], ["answer", "/r/CapableOf", "resolve_a_question"],
      ["idea", "/r/PartOf", "mind"], ["idea", "/r/CapableOf", "inspire_action"],
      ["thought", "/r/PartOf", "mind"], ["thought", "/r/CapableOf", "lead_to_an_idea"],
      ["mind", "/r/CapableOf", "think"], ["mind", "/r/HasA", "thought"],
      ["memory", "/r/PartOf", "mind"], ["memory", "/r/CapableOf", "fade"],
      ["dream", "/r/AtLocation", "sleep"], ["dream", "/r/HasA", "image"],
      ["belief", "/r/PartOf", "mind"], ["belief", "/r/CapableOf", "guide_action"],
      ["love", "/r/IsA", "emotion"], ["love", "/r/CapableOf", "bring_happiness"],
      ["hate", "/r/IsA", "emotion"], ["hate", "/r/CapableOf", "cause_conflict"],
      ["fear", "/r/IsA", "emotion"], ["fear", "/r/CapableOf", "cause_worry"],
      ["joy", "/r/IsA", "emotion"], ["joy", "/r/CapableOf", "bring_happiness"],
      ["anger", "/r/IsA", "emotion"], ["anger", "/r/CapableOf", "cause_conflict"],
      ["hope", "/r/IsA", "emotion"], ["hope", "/r/CapableOf", "inspire_action"],
      ["surprise", "/r/IsA", "emotion"], ["surprise", "/r/CapableOf", "cause_astonishment"],
      ["pride", "/r/IsA", "emotion"], ["pride", "/r/CapableOf", "bring_satisfaction"],
      ["name", "/r/UsedFor", "identifying_a_person"], ["name", "/r/PartOf", "identity"],
      ["song", "/r/HasA", "word"], ["song", "/r/UsedFor", "entertaining"],
      ["music", "/r/HasA", "song"], ["music", "/r/CapableOf", "bring_joy"],
      ["sound", "/r/CapableOf", "travel_through_air"], ["sound", "/r/UsedFor", "communicating"],
      ["voice", "/r/UsedFor", "speaking"], ["voice", "/r/PartOf", "a_person"],
      ["picture", "/r/CapableOf", "show_an_image"], ["picture", "/r/UsedFor", "remembering"],
      ["art", "/r/CapableOf", "express_emotion"], ["art", "/r/UsedFor", "decoration"],
      ["knowledge", "/r/PartOf", "mind"], ["knowledge", "/r/CapableOf", "grow"],
      ["opinion", "/r/PartOf", "mind"], ["opinion", "/r/CapableOf", "differ_between_people"],
      ["reason", "/r/PartOf", "mind"], ["reason", "/r/UsedFor", "explaining"],
      ["imagination", "/r/PartOf", "mind"], ["imagination", "/r/CapableOf", "create_ideas"],
      ["laughter", "/r/CapableOf", "bring_joy"], ["laughter", "/r/AtLocation", "a_joke"],
      ["tear", "/r/CapableOf", "show_sadness"], ["tear", "/r/PartOf", "crying"],
      ["smile", "/r/CapableOf", "show_happiness"], ["smile", "/r/PartOf", "a_face"],
      ["silence", "/r/HasProperty", "quiet"], ["silence", "/r/CapableOf", "calm_the_mind"],

      // ---- human-bridge (~10 facts) — the cross-ontology showcase
      // (PLAN_SEED.md §8): a WordNet-side root/common term paired with its
      // Schema.org-inspired counterpart from human-base, above. scm-sco
      // (src/syllogise.mjs, unmodified) proves a chain spanning both
      // sources once a WordNet-side ⊑-chain reaches one of these —
      // test/chat-cross-ontology-bridge.test.mjs exercises this live.
      ["person", "/r/IsA", "schema_person"],
      ["place", "/r/IsA", "schema_place"],
      ["object", "/r/IsA", "schema_object"],
      ["event", "/r/IsA", "schema_event"],
      ["time", "/r/IsA", "schema_time"],
      ["quantity", "/r/IsA", "schema_quantity"],
      ["organization", "/r/IsA", "schema_organization"],
      ["artifact", "/r/IsA", "schema_object"],
      ["group", "/r/IsA", "schema_organization"],
      ["location", "/r/IsA", "schema_place"],
    ],
  },
};

const conceptUri = (term) => `/c/en/${term}`;
const humanize = (term) => term.replace(/_/g, " ");

/** One curated triple → a tier-1-shaped slice row. */
export function toRow([subject, rel, concept, weight = 1]) {
  return {
    start: conceptUri(subject),
    rel,
    end: conceptUri(concept),
    weight,
    surfaceText: `[[${humanize(subject)}]] ${rel.replace("/r/", "")} [[${humanize(concept)}]]`,
  };
}

/** Curated corpus id → its JSONL text (deterministic order = authored order). */
export function corpusJsonl(id) {
  return CORPUSES[id].facts.map((f) => JSON.stringify(toRow(f))).join("\n") + "\n";
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ---- network-fetch path (opt-in, offline-by-default) -----------------------
// A tier-2 corpus too large to curate by hand is declared in the manifest with
// { "source": { "kind": "fetch", "url": "...", "sha256": "..." } } and pulled by
// a Wave-2 fetch step. This helper is the reference implementation — it is NEVER
// called without an explicit --allow-network flag (the product default is $0,
// offline). No sample corpus uses it; the three samples are all `curated`.
export async function fetchCorpus(url, expectedSha) {
  const res = await fetch(url, { headers: { accept: "application/x-ndjson,application/jsonl" } });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  const got = sha256(text);
  if (expectedSha && got !== expectedSha) throw new Error(`checksum mismatch for ${url}: ${got} != ${expectedSha}`);
  return text;
}

/**
 * Alignment drift-guard for a corpus entry that declares an optional
 * `lexicon` sub-key (today: only `human` — PLAN_SEED.md §4's "two vocabulary
 * surfaces" seam): the corpus fact set and the ACE parser's closed-set
 * vocabulary (src/grammar/lexicon-core.json) are two SEPARATE files, gated
 * independently, so nothing stops them drifting apart over time. Two
 * directions, both real (mirroring conceptnet-map.toml's own "slice relation
 * missing from map = error" precedent):
 *
 *   1. every declared lexicon word ACTUALLY resolves in the real, committed
 *      lexicon-core.json — catches a `lexicon` sub-key entry that was
 *      declared here but never actually added to the file (orphaned intent);
 *   2. every declared lexicon word has AT LEAST ONE supporting occurrence
 *      (as a subject or object) somewhere in this SAME corpus's own facts —
 *      catches a typo'd or stale `lexicon` sub-key entry with nothing behind
 *      it (orphaned metadata, the reverse mistake).
 *
 * Deliberately NOT the other direction (every corpus fact's subject/object
 * term must itself be a declared lexicon word) — that would force every
 * ConceptNet-style background CONCEPT filler this corpus's facts use as an
 * object (e.g. "treating_illness", "growing_into_a_plant") to also become a
 * parseable ACE noun, contradicting the "breadth over depth, no
 * over-modeling" discipline this whole batch was built under, and breaking
 * with EVERY other tier2 corpus's own long-standing precedent (aws.jsonl's
 * "object_storage"/"cloud_platform" concept objects were never lexicon
 * nouns either, and no such stricter check exists for them). The `lexicon`
 * sub-key's OWN declared words (the genuinely teachable/askable common
 * words this corpus's curation deliberately picked out) are what this
 * check verifies both ends of. */
async function verifyLexiconAlignment(id, spec) {
  if (!spec.lexicon) return; // no alignment declared for this corpus — nothing to check
  const nouns = spec.lexicon.nouns || [];
  const verbs = spec.lexicon.verbs || [];
  const adjectives = spec.lexicon.adjectives || [];
  const properNames = (spec.lexicon.properNames || []).map((n) => n.toLowerCase());
  const declared = [...nouns, ...verbs, ...adjectives, ...properNames];

  const lexPath = fileURLToPath(new URL("../../src/grammar/lexicon-core.json", import.meta.url));
  const lex = JSON.parse(await readFile(lexPath, "utf8"));
  const inLexicon = (w) => Boolean(lex.nouns[w] || lex.verbs[w] || lex.adjectives[w]
    || (lex.properNames || []).some((n) => n.toLowerCase() === w));
  const orphanedIntent = declared.filter((w) => !inLexicon(w));
  if (orphanedIntent.length) {
    throw new Error(`${id}: lexicon sub-key names ${orphanedIntent.length} word(s) never actually declared in lexicon-core.json: ${orphanedIntent.slice(0, 10).join(", ")}`);
  }

  // Coverage check 2 is NOUN-only: a fact triple's subject/object are always
  // concept (noun-shaped) terms, so every declared noun should be FOUND
  // there — a real drift signal if not (a typo, or a word dropped from the
  // facts array but left in the lexicon list). VERBS never appear as a bare
  // term at all (a verb maps to the RELATION between two terms, never a term
  // itself) and ADJECTIVES are declared primarily for the LIVE ACE teaching
  // surface ("the man is happy") rather than pre-existing corpus coverage —
  // neither is a meaningful drift signal, so this check is scoped to nouns.
  const factTerms = new Set();
  for (const f of spec.facts) {
    factTerms.add(humanize(f[0]).toLowerCase());
    factTerms.add(humanize(f[2]).toLowerCase());
  }
  const orphanedMetadata = nouns.filter((w) => !factTerms.has(w));
  if (orphanedMetadata.length) {
    throw new Error(`${id}: lexicon sub-key names ${orphanedMetadata.length} noun(s) with no supporting fact in this corpus: ${orphanedMetadata.slice(0, 10).join(", ")}`);
  }
  console.error(`  verify ${id}: lexicon sub-key (${declared.length} words: ${nouns.length} nouns, ${verbs.length} verbs, ${adjectives.length} adjectives, ${properNames.length} proper names) is aligned both ways`);
}

async function main() {
  const verify = process.argv.includes("--verify");
  const manifest = { version: 1, generated: "by corpus/tier2/generate.mjs", corpuses: [] };

  for (const [id, spec] of Object.entries(CORPUSES)) {
    const text = corpusJsonl(id);
    await writeFile(join(HERE, `${id}.jsonl`), text);
    manifest.corpuses.push({
      id,
      kind: spec.kind,
      description: spec.description,
      source: { kind: "curated", tool: "corpus/tier2/generate.mjs" },
      file: `${id}.jsonl`,
      facts: spec.facts.length,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
      license: "MPL-2.0",
    });
    console.error(`  ${id}: ${spec.facts.length} facts, ${Buffer.byteLength(text)} bytes`);
  }

  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(HERE, "manifest.json"), manifestText);
  console.error(`wrote manifest.json (${manifest.corpuses.length} corpuses)`);

  if (verify) {
    const { loadSlice, loadMap, toFacts } = await import("../../src/corpus/conceptnet.mjs");
    const map = await loadMap();
    for (const c of manifest.corpuses) {
      const assertions = await loadSlice(join(HERE, c.file));
      const facts = toFacts(assertions, map); // throws on any unmapped rel
      if (assertions.length !== c.facts) throw new Error(`${c.id}: loadSlice count ${assertions.length} != ${c.facts}`);
      if (facts.length !== c.facts) throw new Error(`${c.id}: ${c.facts - facts.length} fact(s) did not seed (ace=none rel?)`);
      console.error(`  verify ${c.id}: ${assertions.length} assertions load, all ${facts.length} seed cleanly`);
      await verifyLexiconAlignment(c.id, CORPUSES[c.id]);
    }
    console.error("verify: OK — every tier-2 corpus loads and seeds through the tier-1 path");
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
