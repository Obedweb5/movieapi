# @workspace/web

The public-facing frontend for the movie/series catalog — Next.js (App
Router), talking to the API server (`artifacts/api-server`) over HTTP. Built
for SEO on catalog/title pages, with authenticated features (watchlist,
ratings, continue watching) via Clerk, and an admin panel for catalog and
media management.

## Stack

- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS v4
- TanStack Query (client-side data fetching/mutations)
- Clerk (`@clerk/nextjs`) for sign-in
- `@workspace/api-client-react` — the generated, typed API client already in
  this monorepo (same one Orval produces from `lib/api-spec/openapi.yaml`)

## How it talks to the API

Your API server runs on its own origin (a VPS), not on Vercel, so this is a
cross-origin setup:

- **Public pages** (home, browse, title detail) fetch server-side, directly
  from React Server Components, using the generated functions
  (`listTitles`, `getTitle`, etc.) with no auth. Good for SEO — the HTML is
  fully rendered before it reaches a crawler.
- **Authenticated features** (watchlist, ratings, continue watching) run
  client-side via the generated React Query hooks. Since cross-origin
  cookies won't reliably reach the API, the frontend fetches a Clerk session
  token in the browser and attaches it as `Authorization: Bearer <token>`
  (see `src/components/providers.tsx`). Your API server's Clerk instance
  verifies that token the same way it would a cookie-based session.
- **Admin actions** (titles, episodes, media assets, ingestion jobs) are
  gated by the API's static `x-media-admin-key` header, not by Clerk. The
  admin panel asks for that key once and keeps it in the browser's
  `localStorage` (see `src/lib/use-admin-key.ts`).

### Requirements this implies on the API server

- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` on the API must be for the
  **same Clerk instance** as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` /
  `CLERK_SECRET_KEY` here — otherwise tokens minted by this frontend won't
  verify on the API.
- CORS on the API is already permissive (`cors({ origin: true, credentials:
  true })` in `app.ts`), so no changes needed there for a new frontend
  origin.
- `MEDIA_ADMIN_KEY` must be set on the API for the admin panel's media/title
  management to work.

## Local development

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_API_URL (point at your running API server) and the
# Clerk keys

pnpm install
pnpm --filter @workspace/web run dev
```

The app runs on `http://localhost:3000`.

## Deploying to Vercel

This project lives inside a pnpm workspace, which Vercel supports natively.

1. **Import the repo** in Vercel, and set the **Root Directory** to
   `artifacts/web`.
2. Vercel auto-detects Next.js and pnpm (via `pnpm-lock.yaml` at the repo
   root). No custom build command is required — leave the default
   (`next build`, run with the root directory context).
3. **Environment variables** (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_API_URL` — your VPS API's public base URL, including the
     `/api` prefix, e.g. `https://api.yourdomain.com/api`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
4. Deploy. Because `NEXT_PUBLIC_*` variables are baked in at build time,
   redeploy (or trigger a new build) any time you change them.
5. Once deployed, add the Vercel domain (and any custom domain) to your
   Clerk instance's allowed origins in the Clerk dashboard, so the sign-in
   flow works from the new domain.

### Optional: keep the VPS reachable over HTTPS

Browsers will block requests from your HTTPS Vercel domain to a plain HTTP
API. Put the API behind a reverse proxy with TLS (Caddy, Nginx + Let's
Encrypt, Cloudflare Tunnel, etc.) if it isn't already, and point
`NEXT_PUBLIC_API_URL` at the HTTPS address.

## Structure

```
src/
  app/
    page.tsx                 Home (trending + newest + genres)
    browse/page.tsx          Search, filters, pagination
    titles/[id]/page.tsx     Title detail (SSR, SEO metadata)
    my/page.tsx              Watchlist + continue watching (client)
    admin/page.tsx           Admin panel (titles, ingestion, import)
    sign-in/, sign-up/       Clerk auth pages
  components/                Shared UI
    admin/                   Admin-only forms and managers
  lib/
    api-server.ts            Server-side API base URL wiring
    format.ts                Display formatting helpers
    use-admin-key.ts         Client-side admin key storage
```

## Known gap worth knowing about

`POST /catalog/import` on the API is rate-limited but **not** gated by
`MEDIA_ADMIN_KEY` (every other admin route is). The import form here calls
it as-is; you may want to add a key check on the server if this app will be
public.
