// child-seed.mjs — the age-of-acquisition seed for the CHILD triples pack, and
// the licence decision that shaped it. NOT part of the product path — a
// maintainer file, read by scripts/fetch-child-corpus.mjs to select a
// child-concept slice of the full ConceptNet dump. Sits beside
// fetch-slice.mjs's SEED_TERMS on purpose: same role (the seed the dump is
// filtered against), different domain (everyday concepts a young child knows,
// not the software/tech world).
//
// THE LICENCE DECISION (settled before any data was fetched, PLAN step 1).
// The plan proposed seeding from a published age-of-acquisition word list —
// Kuperman, Stadthagen-Gonzalez & Brysbaert (2012), 30,121 rated English
// words — thresholded at AoA <= 8. Two candidates were checked for shippable
// terms, and both were ruled out for a package that ships publicly under
// MPL-2.0:
//
//   - Kuperman et al. 2012 (crr.ugent.be / Center for Reading Research, Ghent).
//     The original distribution site was restructured and its file terms could
//     not be verified directly. The aggregator norare.clld.org relabels its own
//     compilation CC-BY-4.0, but that is the aggregate database's label, not a
//     verified grant on the raw Kuperman file. The same lab's sibling AoA norms
//     (Ghyselinck, Custers & Brysbaert, still live at ugent.be) state their
//     terms plainly: "the norms are for non-profit use only" and "can be
//     downloaded and/or consulted for research purposes." That is a
//     NonCommercial, research-only restriction. Shipping a threshold-filtered
//     derivative list inside a public, commercially-usable npm package is
//     exactly what such terms forbid, and a NoDerivatives condition (common on
//     these norms) would forbid the derivative list on its own. Unverifiable +
//     non-commercial => not shippable here.
//
//   - Dale-Chall 3,000 (the New Dale-Chall list, Chall & Dale, Readability
//     Revisited, Brookline Books, 1995). Widely reproduced online, and an
//     MIT-packaged copy exists (github.com/words/dale-chall). But the 3,000-word
//     list is the selection and arrangement published in a 1995 copyrighted
//     book; "widely reproduced" is not a licence grant from the rights holder,
//     and the clean, verifiable status of the list as distributable data could
//     not be established. Unverifiable => not shippable under the plan's own
//     "do not ship anything whose terms you could not verify" rule.
//
// DECISION: author a maintainer-owned original child-concept seed — the plan's
// named third option, and the honest one. It is hand-curated everyday
// vocabulary (the same first-party pattern as corpus/tier2/human.jsonl), owned
// by this repository under MPL-2.0, and it needs no external licence because it
// copies no external list. It is NOT derived from Kuperman or Dale-Chall: no
// rated or ranked list was filtered to produce it. It is a filter, never a
// source (a word list only selects which ConceptNet edges ship) — so the
// SHIPPED DATA (corpus/child/, the triples) inherits ConceptNet's CC-BY-SA-4.0,
// exactly like corpus/conceptnet/slice.jsonl, while this seed file stays
// MPL-2.0. See corpus/child/LICENSE-NOTICE and corpus/LICENSES.json.

// The curation target: the concepts a bright ~8-year-old knows. This is the
// plan's "top-decile knob" made an explicit number instead of a claim about
// Dutch schooling — the age a maintainer raises to admit an older child's
// vocabulary (widen CHILD_SEED_TERMS to match). Selection is by hand to this
// target, not by thresholding a licensed AoA file (see the licence decision
// above), so the constant documents the curation boundary rather than driving a
// numeric cut.
export const CHILD_AOA_TARGET_YEARS = 8;

// Everyday concepts, underscored to match ConceptNet's bare term URIs
// (/c/en/teddy_bear -> "teddy_bear"), grouped by semantic field. An edge ships
// if EITHER endpoint's bare term is in this set, so a hypernym like "bird"
// pulls in every "<species> IsA bird" edge and a verb like "fly" pulls in every
// "<thing> CapableOf fly" edge without the species or the thing being listed.
// The bird/flight fields are deliberately dense: they are the plan's acceptance
// probes (kinds of bird, capabilities among them, things that can fly).
export const CHILD_SEED_TERMS = [
  // animals — the everyday menagerie
  "animal", "pet", "dog", "puppy", "cat", "kitten", "rabbit", "bunny", "mouse",
  "rat", "hamster", "guinea_pig", "horse", "pony", "cow", "calf", "pig", "piglet",
  "sheep", "lamb", "goat", "chicken", "hen", "rooster", "duck", "duckling",
  "goose", "turkey", "fox", "wolf", "bear", "lion", "tiger", "elephant", "giraffe",
  "zebra", "monkey", "gorilla", "kangaroo", "koala", "panda", "deer", "squirrel",
  "hedgehog", "mole", "bat", "frog", "toad", "snake", "lizard", "turtle", "tortoise",
  "crocodile", "dinosaur", "whale", "dolphin", "shark", "seal", "octopus", "crab",
  "lobster", "starfish", "jellyfish", "snail", "worm", "spider", "ant", "bee",
  "wasp", "fly", "ladybug", "butterfly", "caterpillar", "moth", "beetle", "insect",
  "bug", "grasshopper", "cricket", "dragonfly",
  // birds — dense on purpose (kinds of bird, and what they can do)
  "bird", "robin", "sparrow", "swallow", "swift", "wren", "finch", "blackbird",
  "crow", "raven", "magpie", "pigeon", "dove", "seagull", "gull", "duck", "swan",
  "goose", "owl", "eagle", "hawk", "falcon", "kestrel", "vulture", "parrot",
  "budgie", "canary", "peacock", "flamingo", "stork", "heron", "crane", "penguin",
  "ostrich", "emu", "kiwi", "woodpecker", "kingfisher", "hummingbird", "chick",
  "nest", "feather", "wing", "beak", "egg",
  // the body
  "body", "head", "hair", "face", "eye", "ear", "nose", "mouth", "lip", "tooth",
  "tongue", "cheek", "chin", "neck", "shoulder", "arm", "elbow", "hand", "finger",
  "thumb", "nail", "chest", "tummy", "belly", "back", "bottom", "leg", "knee",
  "foot", "toe", "heart", "bone", "skin", "blood", "brain",
  // family & people
  "family", "mum", "mummy", "mother", "dad", "daddy", "father", "parent", "baby",
  "child", "kid", "boy", "girl", "brother", "sister", "grandma", "grandpa",
  "grandmother", "grandfather", "aunt", "uncle", "cousin", "friend", "person",
  "people", "man", "woman", "teacher", "doctor", "nurse", "dentist", "farmer",
  "police_officer", "firefighter", "postman", "driver", "chef", "king", "queen",
  "prince", "princess", "pirate", "giant", "witch", "wizard", "fairy", "monster",
  "ghost", "dragon",
  // food & drink
  "food", "breakfast", "lunch", "dinner", "snack", "meal", "bread", "toast",
  "butter", "jam", "sandwich", "cheese", "egg", "milk", "water", "juice", "tea",
  "coffee", "cake", "biscuit", "cookie", "chocolate", "sweet", "candy", "sugar",
  "honey", "ice_cream", "lolly", "fruit", "apple", "banana", "orange", "pear",
  "grape", "strawberry", "cherry", "lemon", "peach", "plum", "melon", "pineapple",
  "vegetable", "potato", "carrot", "pea", "bean", "tomato", "cucumber", "lettuce",
  "onion", "corn", "mushroom", "pumpkin", "rice", "pasta", "pizza", "soup",
  "chip", "fish", "meat", "chicken", "sausage", "burger", "salt", "pepper",
  // home
  "house", "home", "flat", "room", "door", "window", "wall", "floor", "ceiling",
  "roof", "stair", "chimney", "garden", "fence", "gate", "kitchen", "bathroom",
  "bedroom", "living_room", "table", "chair", "sofa", "bed", "pillow", "blanket",
  "cupboard", "shelf", "drawer", "lamp", "clock", "mirror", "carpet", "curtain",
  "television", "telephone", "fridge", "oven", "cooker", "sink", "bath", "shower",
  "toilet", "soap", "towel", "toothbrush", "cup", "mug", "glass", "plate", "bowl",
  "spoon", "fork", "knife", "pan", "pot", "kettle", "bottle", "box", "bag",
  "basket", "bucket", "brush", "broom", "key", "candle", "toy",
  // clothes
  "clothes", "shirt", "tshirt", "jumper", "sweater", "coat", "jacket", "dress",
  "skirt", "trousers", "jeans", "shorts", "sock", "shoe", "boot", "slipper",
  "hat", "cap", "scarf", "glove", "mitten", "belt", "button", "pocket", "pyjamas",
  "nappy", "apron", "raincoat", "wellington",
  // school & play
  "school", "class", "classroom", "lesson", "teacher", "pupil", "book", "story",
  "page", "word", "letter", "number", "pencil", "pen", "crayon", "paint",
  "brush", "paper", "glue", "scissors", "ruler", "rubber", "chalk", "desk",
  "bag", "lunchbox", "playground", "swing", "slide", "seesaw", "ball", "bat",
  "kite", "balloon", "bubble", "game", "puzzle", "jigsaw", "block", "brick",
  "doll", "teddy", "teddy_bear", "robot", "drum", "whistle", "marble", "skipping_rope",
  // getting around
  "car", "bus", "lorry", "truck", "van", "taxi", "bike", "bicycle", "tricycle",
  "scooter", "motorbike", "train", "tram", "boat", "ship", "sailboat", "canoe",
  "ferry", "plane", "aeroplane", "airplane", "aircraft", "jet", "helicopter",
  "rocket", "spaceship", "balloon", "wheel", "engine", "road", "street", "bridge",
  "tunnel", "station", "airport", "harbour", "traffic_light",
  // the world outside
  "tree", "leaf", "branch", "root", "trunk", "wood", "forest", "flower", "petal",
  "rose", "daisy", "tulip", "grass", "bush", "plant", "seed", "garden", "park",
  "field", "farm", "hill", "mountain", "valley", "cave", "rock", "stone", "sand",
  "mud", "puddle", "pond", "lake", "river", "stream", "sea", "ocean", "beach",
  "island", "wave", "shell", "cliff", "waterfall",
  // sky & weather
  "sky", "sun", "moon", "star", "cloud", "rainbow", "rain", "snow", "snowflake",
  "ice", "frost", "wind", "storm", "thunder", "lightning", "fog", "sunshine",
  "shadow", "day", "night", "morning", "afternoon", "evening", "weather",
  // time, seasons, celebrations
  "time", "hour", "minute", "week", "month", "year", "today", "tomorrow",
  "yesterday", "birthday", "party", "present", "christmas", "holiday", "weekend",
  "spring", "summer", "autumn", "winter", "season",
  // colours & shapes (concepts, not just adjectives)
  "colour", "color", "red", "orange", "yellow", "green", "blue", "purple", "pink",
  "brown", "black", "white", "grey", "gold", "silver", "shape", "circle", "square",
  "triangle", "rectangle", "star", "heart", "line", "dot",
  // everyday verbs (pull in CapableOf / HasSubevent edges)
  "run", "walk", "jump", "hop", "skip", "climb", "crawl", "swim", "fly", "float",
  "dive", "roll", "spin", "dance", "sing", "shout", "laugh", "cry", "smile",
  "sleep", "wake", "eat", "drink", "bite", "chew", "cook", "bake", "wash", "clean",
  "brush", "read", "write", "draw", "paint", "count", "play", "throw", "catch",
  "kick", "push", "pull", "carry", "build", "break", "fix", "cut", "dig", "plant",
  "grow", "melt", "freeze", "burn", "splash", "bounce", "hide", "chase", "hug",
  "kiss", "help", "share", "give", "take", "find", "lose", "open", "close", "ride",
  "drive", "sail", "row", "hear", "see", "look", "listen", "smell", "taste",
  "touch", "feel", "think", "learn", "teach", "talk", "ask", "answer", "whisper",
  // simple properties & feelings (HasProperty)
  "big", "small", "little", "tall", "short", "long", "tiny", "huge", "fast",
  "slow", "hot", "cold", "warm", "cool", "wet", "dry", "hard", "soft", "loud",
  "quiet", "clean", "dirty", "new", "old", "young", "happy", "sad", "angry",
  "scared", "afraid", "tired", "hungry", "thirsty", "sleepy", "kind", "naughty",
  "good", "bad", "nice", "funny", "silly", "brave", "gentle", "heavy", "light",
  "sweet", "sour", "bright", "dark", "sharp", "round", "sick", "poorly", "better",
];
