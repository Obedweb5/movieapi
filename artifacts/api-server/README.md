# Public Movie Metadata API

This service stores and serves descriptive catalog metadata from publicly
accessible HTML/JSON-LD pages. It intentionally does not inspect, store, proxy,
or return playback URLs, download URLs, manifests, session tokens, cookies,
authorization headers, or other protected streaming data.

## Endpoints

- `GET /api/healthz` — service health
- `GET /api/titles?query=&type=movie|series&genre=&page=&pageSize=` — search and paginate metadata
- `GET /api/titles/:id` — title metadata with episode listings
- `POST /api/catalog/import` — import metadata from an approved public HTML URL

Example import request:

```json
{
  "sourceUrl": "https://public.example/catalog/title",
  "maxPages": 5
}
```

`maxPages` follows same-host links from the submitted page and is capped at 10.
Only same-host HTML pages are considered. The importer rejects local/private
hosts, non-HTML responses, redirects, and URLs that look like stream,
manifest, embed, token, signature, or download resources.

## Configuration

- `DATABASE_URL` — required PostgreSQL connection string
- `PORT` — supplied by the workflow
- `CATALOG_ALLOWED_HOSTS` — optional comma-separated host allowlist. When set,
  imports are accepted only from these hostnames.

Set `CATALOG_ALLOWED_HOSTS` to the public domain you are authorized to index
before importing from a real catalog. Respect that site’s terms, robots rules,
copyright, and rate limits.