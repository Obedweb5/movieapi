import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  GetEpisodePlaybackOptionsParams,
  GetEpisodePlaybackOptionsResponse,
  GetMediaIngestionParams,
  GetMediaIngestionResponse,
  GetPlaybackOptionsParams,
  GetPlaybackOptionsResponse,
  GetTitleParams,
  GetTitleResponse,
  ImportCatalogMetadataBody,
  ImportCatalogMetadataResponse,
  ListTitlesQueryParams,
  ListTitlesResponse,
  RegisterMediaAssetBody,
  RegisterMediaAssetHeader,
  RegisterMediaAssetResponse,
  ServeMediaAssetParams,
  CreateMediaIngestionBody,
  CreateMediaIngestionHeader,
  CreateMediaIngestionResponse,
} from "@workspace/api-zod";
import {
  catalogEpisodesTable,
  catalogTitlesTable,
  db,
  mediaAssetsTable,
} from "@workspace/db";
import { scrapePublicCatalog } from "../lib/catalog-source";
import {
  enqueueMediaIngestion,
  getMediaIngestionJob,
} from "../lib/media-transcoding";
import {
  publicMediaAsset,
  resolveMediaPath,
  signedMediaAsset,
  verifyMediaToken,
} from "../lib/media-signing";

const router: IRouter = Router();

function rewriteHlsManifest(
  content: string,
  currentRelativePath: string,
  assetId: number,
  token: string,
): string {
  const currentDirectory = path.posix.dirname(
    currentRelativePath.replaceAll("\\", "/"),
  );
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("data:")
      ) {
        return line;
      }

      const [resource, query = ""] = trimmed.split("?", 2);
      const childPath = path.posix.normalize(
        path.posix.join(currentDirectory, resource),
      );
      const encodedPath = childPath
        .split("/")
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join("/");
      const childUrl = `/api/media/hls/${assetId}/${token}/${encodedPath}${
        query ? `?${query}` : ""
      }`;
      return line.replace(trimmed, childUrl);
    })
    .join("\n");
}

function signedManifestChildUrl(
  currentRelativePath: string,
  resource: string,
  assetId: number,
  token: string,
  route: "hls" | "dash",
) {
  const childPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(currentRelativePath), resource),
  );
  const encodedPath = childPath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part).replaceAll("%24", "$"))
    .join("/");
  return `/api/media/${route}/${assetId}/${token}/${encodedPath}`;
}

function rewriteDashManifest(
  content: string,
  currentRelativePath: string,
  assetId: number,
  token: string,
): string {
  return content.replace(
    /((?:media|initialization)=")([^"]+)(")/g,
    (_match, prefix: string, resource: string, suffix: string) =>
      `${prefix}${signedManifestChildUrl(
        currentRelativePath,
        resource,
        assetId,
        token,
        "dash",
      )}${suffix}`,
  );
}

function toTitleResponse(title: typeof catalogTitlesTable.$inferSelect) {
  return {
    ...title,
    type: title.type as "movie" | "series",
    rating: title.rating === null ? null : Number(title.rating),
    lastSyncedAt: title.lastSyncedAt,
  };
}

router.get("/titles", async (req, res): Promise<void> => {
  const parsed = ListTitlesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, type, genre, page, pageSize } = parsed.data;
  const filters = [
    type ? eq(catalogTitlesTable.type, type) : undefined,
    query
      ? or(
          ilike(catalogTitlesTable.title, `%${query.replace(/[%_]/g, "\\$&")}%`),
          ilike(catalogTitlesTable.synopsis, `%${query.replace(/[%_]/g, "\\$&")}%`),
        )
      : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(catalogTitlesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(catalogTitlesTable.lastSyncedAt));
  const filtered = genre
    ? rows.filter((row) => row.genres.some((item) => item.toLowerCase() === genre.toLowerCase()))
    : rows;
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map(toTitleResponse);

  res.json(
    ListTitlesResponse.parse({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }),
  );
});

router.get("/titles/:id", async (req, res): Promise<void> => {
  const parsed = GetTitleParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [title] = await db
    .select()
    .from(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, parsed.data.id))
    .limit(1);
  if (!title) {
    res.status(404).json({ error: "Title not found" });
    return;
  }

  const episodes = await db
    .select()
    .from(catalogEpisodesTable)
    .where(eq(catalogEpisodesTable.titleId, title.id))
    .orderBy(catalogEpisodesTable.seasonNumber, catalogEpisodesTable.episodeNumber);

  res.json(
    GetTitleResponse.parse({
      ...toTitleResponse(title),
      episodes,
    }),
  );
});

async function playbackOptions(
  titleId: number,
  episodeId: number | null,
  basePath: string,
) {
  const assets = await db
    .select()
    .from(mediaAssetsTable)
    .where(
      and(
        eq(mediaAssetsTable.titleId, titleId),
        episodeId === null
          ? isNull(mediaAssetsTable.episodeId)
          : eq(mediaAssetsTable.episodeId, episodeId),
      ),
    )
    .orderBy(mediaAssetsTable.height, mediaAssetsTable.bitrateKbps);
  const manifestAsset =
    assets.find(
      (asset) =>
        asset.kind === "manifest" &&
        (asset.mimeType.includes("mpegurl") ||
          asset.relativePath.endsWith(".m3u8")),
    ) ?? assets.find((asset) => asset.kind === "manifest");

  return {
    titleId,
    episodeId,
    manifest: manifestAsset
      ? signedMediaAsset(manifestAsset, basePath)
      : null,
    qualities: assets
      .filter((asset) => asset.kind === "video")
      .map((asset) => signedMediaAsset(asset, basePath)),
    downloads: assets
      .filter((asset) => asset.kind === "download" && asset.isDownloadable)
      .map((asset) => signedMediaAsset(asset, basePath)),
    subtitles: assets
      .filter((asset) => asset.kind === "subtitle")
      .map((asset) => signedMediaAsset(asset, basePath)),
    assets,
  };
}

router.get("/titles/:id/playback", async (req, res): Promise<void> => {
  const parsed = GetPlaybackOptionsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [title] = await db
    .select({ id: catalogTitlesTable.id })
    .from(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, parsed.data.id))
    .limit(1);
  if (!title) {
    res.status(404).json({ error: "Title not found" });
    return;
  }

  const options = await playbackOptions(title.id, null, "/api");
  if (options.assets.length === 0) {
    res.status(404).json({ error: "No media assets registered for this title" });
    return;
  }
  res.json(
    GetPlaybackOptionsResponse.parse({
      titleId: options.titleId,
      episodeId: options.episodeId,
      manifest: options.manifest,
      qualities: options.qualities,
      downloads: options.downloads,
       subtitles: options.subtitles,
    }),
  );
});

router.get("/episodes/:episodeId/playback", async (req, res): Promise<void> => {
  const parsed = GetEpisodePlaybackOptionsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [episode] = await db
    .select({
      id: catalogEpisodesTable.id,
      titleId: catalogEpisodesTable.titleId,
    })
    .from(catalogEpisodesTable)
    .where(eq(catalogEpisodesTable.id, parsed.data.episodeId))
    .limit(1);
  if (!episode) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  const options = await playbackOptions(episode.titleId, episode.id, "/api");
  if (options.assets.length === 0) {
    res.status(404).json({ error: "No media assets registered for this episode" });
    return;
  }
  res.json(
    GetEpisodePlaybackOptionsResponse.parse({
      titleId: options.titleId,
      episodeId: options.episodeId,
      manifest: options.manifest,
      qualities: options.qualities,
      downloads: options.downloads,
       subtitles: options.subtitles,
    }),
  );
});

router.post("/admin/media-assets", async (req, res): Promise<void> => {
  const expectedAdminKey = process.env.MEDIA_ADMIN_KEY;
  const header = RegisterMediaAssetHeader.safeParse({
    "x-media-admin-key": req.get("x-media-admin-key"),
  });
  if (!expectedAdminKey || !header.success || header.data["x-media-admin-key"] !== expectedAdminKey) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }

  const parsed = RegisterMediaAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const filePath = resolveMediaPath(parsed.data.relativePath);
    await fs.stat(filePath);

    const [title] = await db
      .select({ id: catalogTitlesTable.id })
      .from(catalogTitlesTable)
      .where(eq(catalogTitlesTable.id, parsed.data.titleId))
      .limit(1);
    if (!title) {
      res.status(400).json({ error: "Title not found" });
      return;
    }

    if (parsed.data.episodeId !== null && parsed.data.episodeId !== undefined) {
      const [episode] = await db
        .select({ id: catalogEpisodesTable.id, titleId: catalogEpisodesTable.titleId })
        .from(catalogEpisodesTable)
        .where(eq(catalogEpisodesTable.id, parsed.data.episodeId))
        .limit(1);
      if (!episode || episode.titleId !== title.id) {
        res.status(400).json({ error: "Episode does not belong to title" });
        return;
      }
    }

    const [asset] = await db
      .insert(mediaAssetsTable)
      .values({
        titleId: parsed.data.titleId,
        episodeId: parsed.data.episodeId ?? null,
        kind: parsed.data.kind,
        label: parsed.data.label,
        relativePath: parsed.data.relativePath,
        mimeType: parsed.data.mimeType,
        language: parsed.data.language ?? null,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
        bitrateKbps: parsed.data.bitrateKbps ?? null,
        isDownloadable: parsed.data.isDownloadable,
      })
      .onConflictDoUpdate({
        target: [
          mediaAssetsTable.titleId,
          mediaAssetsTable.episodeId,
          mediaAssetsTable.kind,
          mediaAssetsTable.label,
        ],
        set: {
          relativePath: parsed.data.relativePath,
          mimeType: parsed.data.mimeType,
          width: parsed.data.width ?? null,
          height: parsed.data.height ?? null,
          bitrateKbps: parsed.data.bitrateKbps ?? null,
          isDownloadable: parsed.data.isDownloadable,
        },
      })
      .returning();
    if (!asset) {
      res.status(400).json({ error: "Unable to register media asset" });
      return;
    }
    res.status(201).json(RegisterMediaAssetResponse.parse(publicMediaAsset(asset)));
  } catch (error) {
    req.log.warn({ err: error }, "Media asset registration failed");
    res.status(400).json({
      error: error instanceof Error ? error.message : "Media asset is not readable",
    });
  }
});

function hasValidMediaAdminKey(
  req: Request,
  schema: typeof RegisterMediaAssetHeader | typeof CreateMediaIngestionHeader,
): boolean {
  const expectedAdminKey = process.env.MEDIA_ADMIN_KEY;
  const header = schema.safeParse({
    "x-media-admin-key": req.get("x-media-admin-key"),
  });
  return Boolean(
    expectedAdminKey &&
      header.success &&
      header.data["x-media-admin-key"] === expectedAdminKey,
  );
}

router.post("/admin/media-ingestions", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, CreateMediaIngestionHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }

  const parsed = CreateMediaIngestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [title] = await db
      .select({ id: catalogTitlesTable.id })
      .from(catalogTitlesTable)
      .where(eq(catalogTitlesTable.id, parsed.data.titleId))
      .limit(1);
    if (!title) {
      res.status(400).json({ error: "Title not found" });
      return;
    }

    const episodeId = parsed.data.episodeId ?? null;
    if (episodeId !== null) {
      const [episode] = await db
        .select({
          id: catalogEpisodesTable.id,
          titleId: catalogEpisodesTable.titleId,
        })
        .from(catalogEpisodesTable)
        .where(eq(catalogEpisodesTable.id, episodeId))
        .limit(1);
      if (!episode || episode.titleId !== title.id) {
        res.status(400).json({ error: "Episode does not belong to title" });
        return;
      }
    }

    const job = await enqueueMediaIngestion({
      titleId: title.id,
      episodeId,
      sourceRelativePath: parsed.data.sourceRelativePath,
      qualities: parsed.data.qualities,
      subtitles: parsed.data.subtitles,
      includeDownloads: parsed.data.includeDownloads,
    });
    res.status(202).json(CreateMediaIngestionResponse.parse(job));
  } catch (error) {
    req.log.warn({ err: error }, "Media ingestion queueing failed");
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to queue media ingestion",
    });
  }
});

router.get("/admin/media-ingestions/:jobId", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, CreateMediaIngestionHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }

  const parsed = GetMediaIngestionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const job = await getMediaIngestionJob(parsed.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Media ingestion job not found" });
    return;
  }
  res.json(GetMediaIngestionResponse.parse(job));
});

router.get("/media/assets/:assetId/:token", async (req, res): Promise<void> => {
  const parsed = ServeMediaAssetParams.safeParse(req.params);
  if (!parsed.success || !verifyMediaToken(parsed.data.token, parsed.data.assetId)) {
    res.status(401).json({ error: "Invalid or expired media token" });
    return;
  }

  const [asset] = await db
    .select()
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, parsed.data.assetId))
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Media asset not found" });
    return;
  }

  try {
    const filePath = resolveMediaPath(asset.relativePath);
    const stats = await fs.stat(filePath);
    const range = req.headers.range;
    let start = 0;
    let end = stats.size - 1;
    let statusCode = 200;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).set("Content-Range", `bytes */${stats.size}`).end();
        return;
      }
      start = match[1] ? Number(match[1]) : Math.max(0, stats.size - Number(match[2]) || 0);
      end = match[2] ? Number(match[2]) : end;
      if (start > end || start >= stats.size) {
        res.status(416).set("Content-Range", `bytes */${stats.size}`).end();
        return;
      }
      end = Math.min(end, stats.size - 1);
      statusCode = 206;
    }

    res.status(statusCode);
    res.set({
      "Accept-Ranges": "bytes",
      "Content-Type": asset.mimeType,
      "Content-Length": String(end - start + 1),
      ...(statusCode === 206
        ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` }
        : {}),
      ...(req.query.download === "1" && asset.isDownloadable
        ? { "Content-Disposition": `attachment; filename="${asset.label}"` }
        : {}),
    });
    if (
      asset.kind === "manifest" &&
      (asset.mimeType.includes("mpegurl") || asset.relativePath.endsWith(".m3u8"))
    ) {
      const content = await fs.readFile(filePath, "utf8");
      res
        .status(200)
        .set("Content-Type", "application/vnd.apple.mpegurl")
        .send(rewriteHlsManifest(content, asset.relativePath, asset.id, parsed.data.token));
      return;
    }
    if (
      asset.kind === "manifest" &&
      (asset.mimeType.includes("dash") || asset.relativePath.endsWith(".mpd"))
    ) {
      const content = await fs.readFile(filePath, "utf8");
      res
        .status(200)
        .set("Content-Type", "application/dash+xml")
        .send(
          rewriteDashManifest(
            content,
            asset.relativePath,
            asset.id,
            parsed.data.token,
          ),
        );
      return;
    }
    createReadStream(filePath, { start, end }).pipe(res);
  } catch (error) {
    req.log.warn({ err: error, assetId: asset.id }, "Media asset serving failed");
    res.status(404).json({ error: "Media asset file not found" });
  }
});

router.get(
  "/media/hls/:assetId/:token/{*segment}",
  async (req, res): Promise<void> => {
    const parsed = ServeMediaAssetParams.safeParse(req.params);
    if (!parsed.success || !verifyMediaToken(parsed.data.token, parsed.data.assetId)) {
      res.status(401).json({ error: "Invalid or expired media token" });
      return;
    }

    const [manifest] = await db
      .select()
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.id, parsed.data.assetId))
      .limit(1);
    if (!manifest || manifest.kind !== "manifest") {
      res.status(404).json({ error: "HLS manifest not found" });
      return;
    }

    const segment = Array.isArray(req.params.segment)
      ? req.params.segment.join("/")
      : req.params.segment;
    if (!segment) {
      res.status(400).json({ error: "HLS child path is required" });
      return;
    }

    try {
      const manifestPath = resolveMediaPath(manifest.relativePath);
      const manifestDirectory = path.dirname(manifestPath);
      const targetPath = resolveMediaPath(
        path.posix.join(path.posix.dirname(manifest.relativePath), segment),
      );
      const relativeToManifest = path.relative(manifestDirectory, targetPath);
      if (
        relativeToManifest.startsWith("..") ||
        path.isAbsolute(relativeToManifest)
      ) {
        res.status(404).json({ error: "HLS child path is outside manifest directory" });
        return;
      }

      const stats = await fs.stat(targetPath);
      if (targetPath.endsWith(".m3u8")) {
        const content = await fs.readFile(targetPath, "utf8");
        const relativeTarget = path.relative(
          path.dirname(resolveMediaPath(manifest.relativePath)),
          targetPath,
        );
        res
          .status(200)
          .set("Content-Type", "application/vnd.apple.mpegurl")
          .send(
            rewriteHlsManifest(
              content,
              relativeTarget,
              manifest.id,
              parsed.data.token,
            ),
          );
        return;
      }

      res.set({
        "Content-Length": String(stats.size),
        "Cache-Control": "public, max-age=3600",
      });
      res.sendFile(targetPath);
    } catch (error) {
      req.log.warn({ err: error, assetId: manifest.id }, "HLS child serving failed");
      res.status(404).json({ error: "HLS child file not found" });
    }
  },
);

router.get(
  "/media/dash/:assetId/:token/{*segment}",
  async (req, res): Promise<void> => {
    const parsed = ServeMediaAssetParams.safeParse(req.params);
    if (!parsed.success || !verifyMediaToken(parsed.data.token, parsed.data.assetId)) {
      res.status(401).json({ error: "Invalid or expired media token" });
      return;
    }

    const [manifest] = await db
      .select()
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.id, parsed.data.assetId))
      .limit(1);
    if (
      !manifest ||
      manifest.kind !== "manifest" ||
      (!manifest.mimeType.includes("dash") && !manifest.relativePath.endsWith(".mpd"))
    ) {
      res.status(404).json({ error: "DASH manifest not found" });
      return;
    }

    const segment = Array.isArray(req.params.segment)
      ? req.params.segment.join("/")
      : req.params.segment;
    if (!segment) {
      res.status(400).json({ error: "DASH child path is required" });
      return;
    }

    try {
      const manifestPath = resolveMediaPath(manifest.relativePath);
      const manifestDirectory = path.dirname(manifestPath);
      const targetPath = resolveMediaPath(
        path.posix.join(path.posix.dirname(manifest.relativePath), segment),
      );
      const relativeToManifest = path.relative(manifestDirectory, targetPath);
      if (
        relativeToManifest.startsWith("..") ||
        path.isAbsolute(relativeToManifest)
      ) {
        res.status(404).json({ error: "DASH child path is outside manifest directory" });
        return;
      }

      const stats = await fs.stat(targetPath);
      if (targetPath.endsWith(".mpd")) {
        const content = await fs.readFile(targetPath, "utf8");
        const relativeTarget = path.relative(
          path.dirname(resolveMediaPath(manifest.relativePath)),
          targetPath,
        );
        res
          .status(200)
          .set("Content-Type", "application/dash+xml")
          .send(
            rewriteDashManifest(
              content,
              relativeTarget,
              manifest.id,
              parsed.data.token,
            ),
          );
        return;
      }

      res.set({
        "Content-Length": String(stats.size),
        "Cache-Control": "public, max-age=3600",
        "Content-Type": targetPath.endsWith(".m4s")
          ? "video/iso.segment"
          : "application/octet-stream",
      });
      res.sendFile(targetPath);
    } catch (error) {
      req.log.warn({ err: error, assetId: manifest.id }, "DASH child serving failed");
      res.status(404).json({ error: "DASH child file not found" });
    }
  },
);

router.post("/catalog/import", async (req, res): Promise<void> => {
  const parsed = ImportCatalogMetadataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const pages = await scrapePublicCatalog(
      parsed.data.sourceUrl,
      parsed.data.maxPages,
    );
    let imported = 0;

    for (const page of pages) {
      const [title] = await db
        .insert(catalogTitlesTable)
        .values({
          title: page.title,
          type: page.type,
          posterUrl: page.posterUrl,
          synopsis: page.synopsis,
          year: page.year,
          genres: page.genres,
          rating: page.rating?.toFixed(1) ?? null,
          sourceUrl: page.sourceUrl,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: catalogTitlesTable.sourceUrl,
          set: {
            title: page.title,
            type: page.type,
            posterUrl: page.posterUrl,
            synopsis: page.synopsis,
            year: page.year,
            genres: page.genres,
            rating: page.rating?.toFixed(1) ?? null,
            lastSyncedAt: new Date(),
          },
        })
        .returning();
      if (!title) continue;

      for (const episode of page.episodes) {
        await db
          .insert(catalogEpisodesTable)
          .values({
            titleId: title.id,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            synopsis: episode.synopsis,
            airDate: episode.airDate,
            sourceUrl: episode.sourceUrl,
          })
          .onConflictDoUpdate({
            target: [
              catalogEpisodesTable.titleId,
              catalogEpisodesTable.seasonNumber,
              catalogEpisodesTable.episodeNumber,
            ],
            set: {
              title: episode.title,
              synopsis: episode.synopsis,
              airDate: episode.airDate,
              sourceUrl: episode.sourceUrl,
            },
          });
      }
      imported += 1;
    }

    res.json(
      ImportCatalogMetadataResponse.parse({
        sourceUrl: parsed.data.sourceUrl,
        imported,
        skipped: pages.length - imported,
      }),
    );
  } catch (error) {
    req.log.warn({ err: error }, "Public metadata import failed");
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to fetch source metadata",
    });
  }
});

export default router;