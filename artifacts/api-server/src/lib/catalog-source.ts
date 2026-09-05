import dns from "node:dns/promises";
import net from "node:net";

const MAX_DOCUMENT_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const BLOCKED_URL_PARTS = [
  "m3u8",
  "mpd",
  "manifest",
  "stream",
  "download",
  "playback",
  "embed",
  "token",
  "signature",
];

export type ScrapedEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  synopsis: string | null;
  airDate: string | null;
  sourceUrl: string;
};

export type ScrapedTitle = {
  title: string;
  type: "movie" | "series";
  posterUrl: string | null;
  synopsis: string | null;
  year: number | null;
  genres: string[];
  rating: number | null;
  sourceUrl: string;
  episodes: ScrapedEpisode[];
};

type JsonRecord = Record<string, unknown>;

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

async function assertPublicUrl(rawUrl: string, allowedHosts: Set<string>) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https source URLs are supported");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw new Error("Private and local source hosts are not allowed");
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new Error("This source host is not approved");
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Source host resolves to a private address");
  }

  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function toYear(value: unknown): number | null {
  const text = firstString(value);
  if (!text) return null;
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function toDate(value: unknown): string | null {
  const text = firstString(value);
  if (!text) return null;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function toGenres(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function metaContent(html: string, attribute: "name" | "property", value: string) {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${value}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const reversePattern = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${value}["'][^>]*>`,
    "i",
  );
  return decodeHtml(pattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1] ?? "");
}

function jsonLdBlocks(html: string): JsonRecord[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const records: JsonRecord[] = [];

  for (const block of blocks) {
    try {
      const parsed: unknown = JSON.parse(block[1].trim());
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "@graph" in parsed
          ? (parsed as JsonRecord)["@graph"]
          : [parsed];
      for (const value of values as unknown[]) {
        if (value && typeof value === "object") records.push(value as JsonRecord);
      }
    } catch {
      // Ignore malformed structured data and continue with visible metadata.
    }
  }
  return records;
}

function metadataUrl(raw: unknown, baseUrl: string): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (BLOCKED_URL_PARTS.some((part) => url.href.toLowerCase().includes(part))) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function isEpisode(record: JsonRecord): boolean {
  const type = record["@type"];
  return (
    type === "TVEpisode" ||
    (Array.isArray(type) && type.includes("TVEpisode"))
  );
}

function extractEpisode(record: JsonRecord, sourceUrl: string): ScrapedEpisode | null {
  const season = record.partOfSeason;
  const seasonNumber =
    toNumber(
      season && typeof season === "object"
        ? (season as JsonRecord).seasonNumber
        : season,
    ) ?? 1;
  const episodeNumber = toNumber(record.episodeNumber);
  const title = firstString(record.name);
  if (episodeNumber === null || !title) return null;

  return {
    seasonNumber: Math.max(1, Math.trunc(seasonNumber)),
    episodeNumber: Math.max(1, Math.trunc(episodeNumber)),
    title,
    synopsis: firstString(record.description),
    airDate: toDate(record.datePublished),
    sourceUrl: metadataUrl(record.url, sourceUrl) ?? sourceUrl,
  };
}

function extractTitle(html: string, sourceUrl: string, records: JsonRecord[]): ScrapedTitle {
  const mainRecord =
    records.find((record) => !isEpisode(record) && record.name) ?? {};
  const typeValue = mainRecord["@type"];
  const typeText = Array.isArray(typeValue) ? typeValue.join(" ") : String(typeValue ?? "");
  const title =
    firstString(
      mainRecord.name,
      metaContent(html, "property", "og:title"),
      metaContent(html, "name", "twitter:title"),
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1],
      new URL(sourceUrl).pathname.split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " "),
    ) ?? "Untitled";

  const image = mainRecord.image;
  const posterUrl = metadataUrl(
    Array.isArray(image) ? image[0] : image ?? metaContent(html, "property", "og:image"),
    sourceUrl,
  );
  const aggregateRating =
    mainRecord.aggregateRating && typeof mainRecord.aggregateRating === "object"
      ? (mainRecord.aggregateRating as JsonRecord).ratingValue
      : null;
  const year =
    toYear(mainRecord.dateCreated) ??
    toYear(mainRecord.releaseDate) ??
    toYear(metaContent(html, "property", "article:published_time"));

  const pathHint = new URL(sourceUrl).pathname;
  return {
    title: title.replace(/\s*[|·-]\s*(MovieBox|Watch.*)$/i, "").trim(),
    type: /series|tvseries|show|season/i.test(`${typeText} ${pathHint}`)
      ? "series"
      : "movie",
    posterUrl,
    synopsis: firstString(
      mainRecord.description,
      metaContent(html, "name", "description"),
      metaContent(html, "property", "og:description"),
    ),
    year,
    genres: toGenres(mainRecord.genre ?? metaContent(html, "property", "article:section")),
    rating: toNumber(aggregateRating ?? mainRecord.ratingValue),
    sourceUrl,
    episodes: records
      .filter(isEpisode)
      .map((record) => extractEpisode(record, sourceUrl))
      .filter((episode): episode is ScrapedEpisode => episode !== null),
  };
}

async function fetchPublicHtml(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Source returned an invalid redirect");
      throw new Error("Redirected sources must be submitted as their final public URL");
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error("Source is not an HTML metadata page");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source returned an empty response");
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < MAX_DOCUMENT_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    return html.slice(0, MAX_DOCUMENT_BYTES);
  } finally {
    clearTimeout(timeout);
  }
}

function crawlLinks(html: string, sourceUrl: URL): string[] {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => metadataUrl(match[1], sourceUrl.href))
    .filter((url): url is string => Boolean(url))
    .filter((url) => {
      const parsed = new URL(url);
      return (
        parsed.hostname === sourceUrl.hostname &&
        !/\.(jpg|jpeg|png|gif|webp|css|js|zip|mp4|mkv)$/i.test(parsed.pathname) &&
        !BLOCKED_URL_PARTS.some((part) => parsed.href.toLowerCase().includes(part))
      );
    });
  return [...new Set(links)];
}

export async function scrapePublicCatalog(
  rawSourceUrl: string,
  maxPages: number,
): Promise<ScrapedTitle[]> {
  const configuredHosts = new Set(
    (process.env.CATALOG_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  const firstUrl = await assertPublicUrl(rawSourceUrl, configuredHosts);
  const urls = [firstUrl.href];
  const results: ScrapedTitle[] = [];

  for (let index = 0; index < urls.length && index < maxPages; index += 1) {
    const current = await assertPublicUrl(urls[index], configuredHosts);
    const html = await fetchPublicHtml(current);
    const records = jsonLdBlocks(html);
    results.push(extractTitle(html, current.href, records));

    if (index === 0 && maxPages > 1) {
      for (const link of crawlLinks(html, current)) {
        if (!urls.includes(link)) urls.push(link);
        if (urls.length >= maxPages) break;
      }
    }
  }

  return results;
}