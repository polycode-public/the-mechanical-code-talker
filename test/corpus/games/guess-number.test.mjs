// Games lane, guess-number shard: the closed-loop guessing game in both
// roles — tmct bisecting a belief interval over the human's secret, and tmct
// holding a committed secret against the human's guesses. The thinker rows
// pin a deterministic secret through the TMCT_GAME_SECRET env seam
// (setup.env), which exists for tests only.
import { runLane } from "../run-lane.mjs";

runLane("games/guess-number");
