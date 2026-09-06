export * from "./generated/api";
export * from "./generated/types";

// Orval's zod-target `types` output generates a merged path+query params
// interface under the same name as the path-only zod object exported from
// `./generated/api` whenever an operation has both path and query
// parameters (e.g. GET /titles/{id}/similar, GET /titles/{id}/ratings).
// Explicitly re-export the *value* (the actual zod object callers need to
// call `.safeParse`/`.parse` on) so it isn't shadowed by the ambiguous
// star-export. See .agents/memory/openapi-zod-param-name-collision.md
export {
  ListSimilarTitlesParams,
  ListTitleRatingsParams,
} from "./generated/api";
