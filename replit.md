# Public Movie Metadata API

A metadata-only catalog API for publicly accessible movie and series pages.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for the catalog API contract
- `lib/db/src/schema/catalog.ts` — PostgreSQL title and episode tables
- `artifacts/api-server/src/lib/catalog-source.ts` — guarded public metadata parser
- `artifacts/api-server/src/routes/catalog.ts` — catalog search, detail, and import routes

## Architecture decisions

- The importer reads only HTML metadata and JSON-LD descriptive fields; it never handles playback or download resources.
- Public-source fetching blocks local/private hosts, non-HTML responses, redirects, and suspicious streaming resource paths.
- OpenAPI remains the source of truth; generated Zod schemas validate every catalog request and response.

## Product

- Search and paginate movie/series metadata.
- View title details and episode listings.
- Import public metadata from an approved, same-host HTML catalog.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Set `CATALOG_ALLOWED_HOSTS` to restrict imports to a known public hostname.
- Run `pnpm --filter @workspace/api-spec run codegen` after OpenAPI changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
