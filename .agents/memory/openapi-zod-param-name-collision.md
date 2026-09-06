---
name: OpenAPI Zod param name collision
description: Orval's zod "types" output can collide with generated/api.ts when an operation has both path and query params.
---

**Why:** For an operation with only path params (e.g. `GET /titles/{id}`), Orval
names the path-params zod object `<OperationId>Params` in `generated/api.ts`
and does not emit a matching file in `generated/types/`. But once an
operation has *both* path and query params (e.g.
`GET /titles/{id}/similar?limit=`), Orval's zod `schemas` output additionally
emits a merged params interface in `generated/types/<operationId>Params.ts`
under that same `<OperationId>Params` name. `lib/api-zod/src/index.ts`
re-exports both `./generated/api` and `./generated/types` with `export *`,
and TypeScript treats the repeated name as ambiguous (TS2308) even though
one is a value and the other a type.

**How to apply:** In the hand-maintained `lib/api-zod/src/index.ts`, after
the two `export *` lines, add an explicit `export { ... } from
"./generated/api"` (a VALUE re-export, not `export type`) naming the
colliding identifiers — route code needs the runtime zod object to call
`.safeParse`/`.parse` on, so the type-only version must not shadow it. Do
this any time a new operation combines path + query parameters and `pnpm
run typecheck:libs` reports a fresh TS2308 for that operation's `Params`
name.
