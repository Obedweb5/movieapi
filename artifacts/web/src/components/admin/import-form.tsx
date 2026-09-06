"use client";

import { useState } from "react";
import { useImportCatalogMetadata } from "@workspace/api-client-react";

export function ImportForm() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [maxPages, setMaxPages] = useState(1);

  const importMutation = useImportCatalogMetadata();

  return (
    <div className="max-w-md">
      <h2 className="mb-2 font-display text-xl italic text-paper">
        Import public metadata
      </h2>
      <p className="mb-4 text-sm text-muted-dim">
        Pulls HTML metadata and JSON-LD from an approved host (see{" "}
        <code>CATALOG_ALLOWED_HOSTS</code> on the API server). This never
        touches playback or download resources.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          importMutation.mutate({ data: { sourceUrl, maxPages } });
        }}
        className="space-y-3"
      >
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
          Source URL
          <input
            required
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/catalog/some-title"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
          Max pages
          <input
            type="number"
            min={1}
            max={10}
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
            className="admin-input"
          />
        </label>
        <button
          type="submit"
          disabled={importMutation.isPending}
          className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
        >
          Import
        </button>
      </form>

      {importMutation.isSuccess && (
        <p className="mt-4 text-sm text-muted-dim">
          Imported {importMutation.data.imported}, skipped{" "}
          {importMutation.data.skipped}.
        </p>
      )}
      {importMutation.isError && (
        <p className="mt-4 text-sm text-rose">
          Import failed: {String(importMutation.error)}
        </p>
      )}
    </div>
  );
}
