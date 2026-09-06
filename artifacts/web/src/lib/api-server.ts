import "server-only";
import { setBaseUrl } from "@workspace/api-client-react";

/**
 * The catalog API lives on a separate origin (the VPS), so every request —
 * server or client — needs an absolute base URL. This module is imported
 * for its side effect wherever a server component calls a generated API
 * function directly (no React Query, no browser).
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!apiUrl) {
  // eslint-disable-next-line no-console
  console.warn(
    "NEXT_PUBLIC_API_URL is not set. Server-rendered catalog pages will fail to fetch data.",
  );
}

setBaseUrl(apiUrl ?? null);

export const API_BASE_URL = apiUrl ?? "";
