# Public Movie Metadata API

This service stores and serves descriptive catalog metadata from publicly
accessible HTML/JSON-LD pages. It intentionally does not inspect, store, proxy,
or return playback URLs, download URLs, manifests, session tokens, cookies,
authorization headers, or other protected streaming data.

## Endpoints

- `GET /api/healthz` — service health
- `GET /api/titles?query=&type=movie|series&genre=&page=&pageSize=` — search and paginate metadata
- `GET /api/titles/:id` — title metadata with episode listings
- `GET /api/titles/:id/playback` — signed playback options for title-level media
- `GET /api/episodes/:episodeId/playback` — signed playback options for a selected episode
- `GET /api/media/assets/:assetId/:token` — signed byte-range media serving
- `POST /api/admin/media-assets` — register an owned local media file
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

## VPS media setup

Set these environment variables on the VPS:

- `MEDIA_LIBRARY_ROOT` — directory containing your own encoded media files
- `MEDIA_ADMIN_KEY` — private key required to register files
- `MEDIA_SIGNING_SECRET` — signing secret for expiring playback URLs. If omitted,
  `SESSION_SECRET` is used.

Register a pre-encoded file:

```bash
curl -X POST https://your-domain.example/api/admin/media-assets \
  -H "Content-Type: application/json" \
  -H "x-media-admin-key: $MEDIA_ADMIN_KEY" \
  -d '{
    "titleId": 1,
    "kind": "video",
    "label": "1080p",
    "relativePath": "titles/1/1080p.mp4",
    "mimeType": "video/mp4",
    "width": 1920,
    "height": 1080,
    "bitrateKbps": 5000,
    "isDownloadable": true
  }'
```

For HLS, register a `manifest` asset with
`application/vnd.apple.mpegurl`, plus one or more `video` assets for quality
selection. The service only serves files inside `MEDIA_LIBRARY_ROOT`, validates
signed URLs, and supports HTTP byte ranges.