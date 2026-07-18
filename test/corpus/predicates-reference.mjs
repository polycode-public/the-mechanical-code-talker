// Reference lane predicates: the lane replays chat sessions over the shipped
// reference pack, so it needs the grammar lane's answer/record readers — the
// citation-frame checks are regex rows, and the negatives lean on the
// miss/lacks predicates.
export {
  answerBody, bodyEquals, bodyMatches,
  answerHasAll, answerLacks, answerMatchesAll, answerMatchesNone,
  notMiss, isMiss,
} from "./predicates-grammar.mjs";
