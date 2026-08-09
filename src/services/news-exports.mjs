// news-exports.mjs — the package's `./news` export subpath: the news
// library contract (PLAN_NEWS_FEED.md section 10.2/6.7) reachable without
// pulling in the chat/grammar engine the "." entry also carries. Re-exports
// news.mjs's engine calls, state constructor and metrics, plus the built-in
// fetchers and courtesy gate as optional conveniences for a consumer that
// wants tmct's own source adapters rather than supplying its own.

export {
  NEWS_DEFAULTS,
  clampNewsConfig,
  resolveNewsConfig,
  parseNewsRequest,
  pollNewsSources,
  ingestNewsSnapshot,
  enrichTopTerms,
  reprocessAfterGrounding,
  isVocabGroundedTerm,
  isFactGroundedTerm,
  ingestUploadedFactRows,
  buildFeed,
  newsTurn,
  cycleMetrics,
  createNewsState,
  NEWS_SOURCE_RECORDS,
  DEFAULT_NEWS_SOURCE_IDS,
  DEFAULT_NEWS_KB_IDS,
} from "./news.mjs";

export {
  createNewsFetcher,
  preflightNewsUrl,
  registerNewsSource,
  newsSourceRecords,
  normalizeNewsSourceIds,
  NEWS_USER_AGENT,
} from "../adapters/corpus/news-sources.mjs";

export {
  createCourtesyGate,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MIN_INTERVAL_MS,
  RETRY_AFTER_FLOOR_MS,
  MAXLAG_SECONDS,
} from "../adapters/corpus/courtesy.mjs";
