import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, avg, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
  GetEpisodeProgressParams,
  GetEpisodeProgressResponse,
  GetTitleProgressParams,
  GetTitleProgressResponse,
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
  UpdateEpisodeProgressBody,
  UpdateEpisodeProgressResponse,
  UpdateTitleProgressBody,
  UpdateTitleProgressResponse,
  ListGenresResponse,
  ListTrendingTitlesQueryParams,
  ListTrendingTitlesResponse,
  ListSimilarTitlesParams,
  ListSimilarTitlesQueryParams,
  ListSimilarTitlesResponse,
  ListContinueWatchingQueryParams,
  ListContinueWatchingResponse,
  ListWatchlistResponse,
  AddToWatchlistParams,
  RemoveFromWatchlistParams,
  ListTitleRatingsParams,
  ListTitleRatingsQueryParams,
  ListTitleRatingsResponse,
  UpsertTitleRatingParams,
  UpsertTitleRatingBody,
  UpsertTitleRatingResponse,
  DeleteTitleRatingParams,
  CreateTitleHeader,
  CreateTitleBody,
  CreateTitleResponse,
  UpdateTitleParams,
  UpdateTitleHeader,
  UpdateTitleBody,
  UpdateTitleResponse,
  DeleteTitleParams,
  DeleteTitleHeader,
  CreateEpisodeParams,
  CreateEpisodeHeader,
  CreateEpisodeBody,
  CreateEpisodeResponse,
  UpdateEpisodeParams,
  UpdateEpisodeHeader,
  UpdateEpisodeBody,
  UpdateEpisodeResponse,
  DeleteEpisodeParams,
  DeleteEpisodeHeader,
  DeleteMediaAssetParams,
  DeleteMediaAssetHeader,
  ListMediaIngestionsQueryParams,
  ListMediaIngestionsHeader,
  ListMediaIngestionsResponse,
  RetryMediaIngestionParams,
  RetryMediaIngestionHeader,
  RetryMediaIngestionResponse,
} from "@workspace/api-zod";
import {
  catalogEpisodesTable,
  catalogTitlesTable,
  db,
  mediaAssetsTable,
  mediaIngestionJobsTable,
  watchProgressTable,
  watchlistTable,
  titleRatingsTable,
} from "@workspace/db";
import { scrapePublicCatalog } from "../lib/catalog-source";
import {
  enqueueMediaIngestion,
  getMediaIngestionJob,
  listMediaIngestionJobs,
  retryMediaIngestionJob,
} from "../lib/media-transcoding";
import {
  publicMediaAsset,
  resolveMediaPath,
  signedMediaAsset,
  verifyMediaToken,
} from "../lib/media-signing";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";

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

  const { query, type, genre, year, sort, page, pageSize } = parsed.data;
  const filters = [
    type ? eq(catalogTitlesTable.type, type) : undefined,
    year ? eq(catalogTitlesTable.year, year) : undefined,
    query
      ? or(
          ilike(catalogTitlesTable.title, `%${query.replace(/[%_]/g, "\\$&")}%`),
          ilike(catalogTitlesTable.synopsis, `%${query.replace(/[%_]/g, "\\$&")}%`),
        )
      : undefined,
  ].filter(Boolean);
  const orderBy = (() => {
    switch (sort) {
      case "oldest":
        return catalogTitlesTable.lastSyncedAt;
      case "rating":
        return desc(catalogTitlesTable.rating);
      case "popular":
        return desc(catalogTitlesTable.viewCount);
      case "title":
        return catalogTitlesTable.title;
      case "newest":
      default:
        return desc(catalogTitlesTable.lastSyncedAt);
    }
  })();
  const rows = await db
    .select()
    .from(catalogTitlesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(orderBy);
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

router.get("/titles/genres", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ genres: catalogTitlesTable.genres })
    .from(catalogTitlesTable);
  const genreSet = new Set<string>();
  for (const row of rows) {
    for (const genre of row.genres) genreSet.add(genre);
  }
  res.json(
    ListGenresResponse.parse({
      genres: Array.from(genreSet).sort((a, b) => a.localeCompare(b)),
    }),
  );
});

router.get("/titles/trending", async (req, res): Promise<void> => {
  const parsed = ListTrendingTitlesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(catalogTitlesTable)
    .where(sql`${catalogTitlesTable.viewCount} > 0`)
    .orderBy(desc(catalogTitlesTable.viewCount), desc(catalogTitlesTable.lastSyncedAt))
    .limit(parsed.data.limit);
  res.json(ListTrendingTitlesResponse.parse(rows.map(toTitleResponse)));
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

router.get("/titles/:id/similar", async (req, res): Promise<void> => {
  const parsed = ListSimilarTitlesParams.safeParse(req.params);
  const query = ListSimilarTitlesQueryParams.safeParse(req.query);
  if (!parsed.success || !query.success) {
    res.status(400).json({
      error: !parsed.success ? parsed.error.message : (query as { error: { message: string } }).error.message,
    });
    return;
  }

  const [title] = await db
    .select({ id: catalogTitlesTable.id, genres: catalogTitlesTable.genres })
    .from(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, parsed.data.id))
    .limit(1);
  if (!title) {
    res.status(404).json({ error: "Title not found" });
    return;
  }

  if (title.genres.length === 0) {
    res.json(ListSimilarTitlesResponse.parse([]));
    return;
  }

  const rows = await db
    .select()
    .from(catalogTitlesTable)
    .where(
      and(
        ne(catalogTitlesTable.id, title.id),
        sql`${catalogTitlesTable.genres} && ${title.genres}`,
      ),
    )
    .orderBy(desc(catalogTitlesTable.rating), desc(catalogTitlesTable.viewCount))
    .limit(query.data.limit);

  res.json(ListSimilarTitlesResponse.parse(rows.map(toTitleResponse)));
});

function toProgressResponse(
  progress: typeof watchProgressTable.$inferSelect,
) {
  return {
    titleId: progress.titleId,
    episodeId: progress.episodeId,
    positionSeconds: progress.positionSeconds,
    durationSeconds: progress.durationSeconds,
    completed: progress.completed,
    updatedAt: progress.updatedAt,
  };
}

async function getTitleProgress(
  userId: string,
  titleId: number,
  episodeId: number | null | undefined,
) {
  const filters = [
    eq(watchProgressTable.userId, userId),
    eq(watchProgressTable.titleId, titleId),
    episodeId === undefined
      ? undefined
      : episodeId === null
        ? isNull(watchProgressTable.episodeId)
        : eq(watchProgressTable.episodeId, episodeId),
  ].filter(Boolean);

  return db
    .select()
    .from(watchProgressTable)
    .where(and(...filters))
    .orderBy(desc(watchProgressTable.updatedAt));
}

async function saveProgress({
  userId,
  titleId,
  episodeId,
  positionSeconds,
  durationSeconds,
  completed,
}: {
  userId: string;
  titleId: number;
  episodeId: number | null;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
}) {
  const values = {
    userId,
    titleId,
    episodeId,
    positionSeconds,
    durationSeconds,
    completed,
    updatedAt: new Date(),
  };

  const [inserted] = await db
    .insert(watchProgressTable)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const filters = [
    eq(watchProgressTable.userId, userId),
    eq(watchProgressTable.titleId, titleId),
    episodeId === null
      ? isNull(watchProgressTable.episodeId)
      : eq(watchProgressTable.episodeId, episodeId),
  ];
  const [updated] = await db
    .update(watchProgressTable)
    .set(values)
    .where(and(...filters))
    .returning();
  return updated;
}

async function ensureTitleAndEpisode(
  titleId: number,
  episodeId: number | null,
) {
  const [title] = await db
    .select({ id: catalogTitlesTable.id })
    .from(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, titleId))
    .limit(1);
  if (!title) return "Title not found";

  if (episodeId !== null) {
    const [episode] = await db
      .select({
        id: catalogEpisodesTable.id,
        titleId: catalogEpisodesTable.titleId,
      })
      .from(catalogEpisodesTable)
      .where(eq(catalogEpisodesTable.id, episodeId))
      .limit(1);
    if (!episode) return "Episode not found";
    if (episode.titleId !== titleId) return "Episode does not belong to title";
  }
  return null;
}

router.get(
  "/titles/:id/progress",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = GetTitleProgressParams.safeParse(req.params);
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

    const progress = await getTitleProgress(
      res.locals.userId,
      title.id,
      undefined,
    );
    res.json(
      GetTitleProgressResponse.parse({
        titleId: title.id,
        items: progress.map(toProgressResponse),
      }),
    );
  },
);

router.put(
  "/titles/:id/progress",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetTitleProgressParams.safeParse(req.params);
    const body = UpdateTitleProgressBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request",
      });
      return;
    }

    const episodeId = body.data.episodeId ?? null;
    const validationError = await ensureTitleAndEpisode(params.data.id, episodeId);
    if (validationError) {
      res
        .status(
          validationError === "Title not found" ||
            validationError === "Episode not found"
            ? 404
            : 400,
        )
        .json({
        error: validationError,
      });
      return;
    }

    const progress = await saveProgress({
      userId: res.locals.userId,
      titleId: params.data.id,
      episodeId,
      positionSeconds: body.data.positionSeconds,
      durationSeconds: body.data.durationSeconds ?? null,
      completed: body.data.completed,
    });
    if (!progress) {
      res.status(409).json({ error: "Unable to save progress" });
      return;
    }
    res.json(
      UpdateTitleProgressResponse.parse(toProgressResponse(progress)),
    );
  },
);

router.get(
  "/episodes/:episodeId/progress",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = GetEpisodeProgressParams.safeParse(req.params);
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

    const [progress] = await getTitleProgress(
      res.locals.userId,
      episode.titleId,
      episode.id,
    );
    res.json(
      GetEpisodeProgressResponse.parse(
        progress ? toProgressResponse(progress) : null,
      ),
    );
  },
);

router.put(
  "/episodes/:episodeId/progress",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetEpisodeProgressParams.safeParse(req.params);
    const body = UpdateEpisodeProgressBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request",
      });
      return;
    }

    const [episode] = await db
      .select({
        id: catalogEpisodesTable.id,
        titleId: catalogEpisodesTable.titleId,
      })
      .from(catalogEpisodesTable)
      .where(eq(catalogEpisodesTable.id, params.data.episodeId))
      .limit(1);
    if (!episode) {
      res.status(404).json({ error: "Episode not found" });
      return;
    }

    const progress = await saveProgress({
      userId: res.locals.userId,
      titleId: episode.titleId,
      episodeId: episode.id,
      positionSeconds: body.data.positionSeconds,
      durationSeconds: body.data.durationSeconds ?? null,
      completed: body.data.completed,
    });
    if (!progress) {
      res.status(409).json({ error: "Unable to save progress" });
      return;
    }
    res.json(
      UpdateEpisodeProgressResponse.parse(toProgressResponse(progress)),
    );
  },
);

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
  await db
    .update(catalogTitlesTable)
    .set({ viewCount: sql`${catalogTitlesTable.viewCount} + 1` })
    .where(eq(catalogTitlesTable.id, title.id));
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

router.get(
  "/me/continue-watching",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = ListContinueWatchingQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const rows = await db
      .select({
        progress: watchProgressTable,
        title: catalogTitlesTable,
      })
      .from(watchProgressTable)
      .innerJoin(
        catalogTitlesTable,
        eq(watchProgressTable.titleId, catalogTitlesTable.id),
      )
      .where(
        and(
          eq(watchProgressTable.userId, res.locals.userId),
          eq(watchProgressTable.completed, false),
        ),
      )
      .orderBy(desc(watchProgressTable.updatedAt))
      .limit(parsed.data.limit);

    res.json(
      ListContinueWatchingResponse.parse(
        rows.map((row) => ({
          title: toTitleResponse(row.title),
          progress: toProgressResponse(row.progress),
        })),
      ),
    );
  },
);

router.get("/me/watchlist", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select({ title: catalogTitlesTable })
    .from(watchlistTable)
    .innerJoin(
      catalogTitlesTable,
      eq(watchlistTable.titleId, catalogTitlesTable.id),
    )
    .where(eq(watchlistTable.userId, res.locals.userId))
    .orderBy(desc(watchlistTable.createdAt));

  res.json(ListWatchlistResponse.parse(rows.map((row) => toTitleResponse(row.title))));
});

router.post(
  "/titles/:id/watchlist",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = AddToWatchlistParams.safeParse(req.params);
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

    await db
      .insert(watchlistTable)
      .values({ userId: res.locals.userId, titleId: title.id })
      .onConflictDoNothing();
    res.status(201).end();
  },
);

router.delete(
  "/titles/:id/watchlist",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = RemoveFromWatchlistParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    await db
      .delete(watchlistTable)
      .where(
        and(
          eq(watchlistTable.userId, res.locals.userId),
          eq(watchlistTable.titleId, parsed.data.id),
        ),
      );
    res.status(204).end();
  },
);

function toRatingResponse(rating: typeof titleRatingsTable.$inferSelect) {
  return {
    id: rating.id,
    titleId: rating.titleId,
    score: rating.score,
    review: rating.review,
    createdAt: rating.createdAt,
    updatedAt: rating.updatedAt,
  };
}

router.get("/titles/:id/ratings", async (req, res): Promise<void> => {
  const params = ListTitleRatingsParams.safeParse(req.params);
  const query = ListTitleRatingsQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : (query as { error: { message: string } }).error.message,
    });
    return;
  }

  const [title] = await db
    .select({ id: catalogTitlesTable.id })
    .from(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, params.data.id))
    .limit(1);
  if (!title) {
    res.status(404).json({ error: "Title not found" });
    return;
  }

  const [summary] = await db
    .select({
      averageScore: avg(titleRatingsTable.score),
      ratingCount: count(titleRatingsTable.id),
    })
    .from(titleRatingsTable)
    .where(eq(titleRatingsTable.titleId, title.id));

  const { page, pageSize } = query.data;
  const rows = await db
    .select()
    .from(titleRatingsTable)
    .where(eq(titleRatingsTable.titleId, title.id))
    .orderBy(desc(titleRatingsTable.updatedAt));
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize).map(toRatingResponse);

  res.json(
    ListTitleRatingsResponse.parse({
      titleId: title.id,
      averageScore: summary?.averageScore ? Number(summary.averageScore) : null,
      ratingCount: summary?.ratingCount ?? 0,
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }),
  );
});

router.put(
  "/titles/:id/rating",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpsertTitleRatingParams.safeParse(req.params);
    const body = UpsertTitleRatingBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : (body as { error: { message: string } }).error.message,
      });
      return;
    }

    const [title] = await db
      .select({ id: catalogTitlesTable.id })
      .from(catalogTitlesTable)
      .where(eq(catalogTitlesTable.id, params.data.id))
      .limit(1);
    if (!title) {
      res.status(404).json({ error: "Title not found" });
      return;
    }

    const values = {
      userId: res.locals.userId,
      titleId: title.id,
      score: body.data.score,
      review: body.data.review ?? null,
      updatedAt: new Date(),
    };

    const [inserted] = await db
      .insert(titleRatingsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [titleRatingsTable.userId, titleRatingsTable.titleId],
        set: {
          score: values.score,
          review: values.review,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    if (!inserted) {
      res.status(400).json({ error: "Unable to save rating" });
      return;
    }
    res.json(UpsertTitleRatingResponse.parse(toRatingResponse(inserted)));
  },
);

router.delete(
  "/titles/:id/rating",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = DeleteTitleRatingParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    await db
      .delete(titleRatingsTable)
      .where(
        and(
          eq(titleRatingsTable.userId, res.locals.userId),
          eq(titleRatingsTable.titleId, parsed.data.id),
        ),
      );
    res.status(204).end();
  },
);

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
  await db
    .update(catalogTitlesTable)
    .set({ viewCount: sql`${catalogTitlesTable.viewCount} + 1` })
    .where(eq(catalogTitlesTable.id, episode.titleId));
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

router.post("/admin/titles", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, CreateTitleHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const parsed = CreateTitleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [title] = await db
      .insert(catalogTitlesTable)
      .values({
        title: parsed.data.title,
        type: parsed.data.type,
        posterUrl: parsed.data.posterUrl ?? null,
        synopsis: parsed.data.synopsis ?? null,
        year: parsed.data.year ?? null,
        genres: parsed.data.genres ?? [],
        rating:
          parsed.data.rating === null || parsed.data.rating === undefined
            ? null
            : String(parsed.data.rating),
        sourceUrl: parsed.data.sourceUrl,
      })
      .returning();
    if (!title) {
      res.status(400).json({ error: "Unable to create title" });
      return;
    }
    res.status(201).json(CreateTitleResponse.parse(toTitleResponse(title)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create title";
    const isConflict = message.includes("duplicate key") || message.includes("unique");
    res.status(isConflict ? 409 : 400).json({
      error: isConflict ? "A title with this sourceUrl already exists" : message,
    });
  }
});

router.put("/admin/titles/:id", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, UpdateTitleHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const params = UpdateTitleParams.safeParse(req.params);
  const body = UpdateTitleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : (body as { error: { message: string } }).error.message,
    });
    return;
  }

  const updates: Partial<typeof catalogTitlesTable.$inferInsert> = {};
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.type !== undefined) updates.type = body.data.type;
  if (body.data.posterUrl !== undefined) updates.posterUrl = body.data.posterUrl;
  if (body.data.synopsis !== undefined) updates.synopsis = body.data.synopsis;
  if (body.data.year !== undefined) updates.year = body.data.year;
  if (body.data.genres !== undefined) updates.genres = body.data.genres;
  if (body.data.rating !== undefined) {
    updates.rating = body.data.rating === null ? null : String(body.data.rating);
  }

  const [updated] = await db
    .update(catalogTitlesTable)
    .set(updates)
    .where(eq(catalogTitlesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Title not found" });
    return;
  }
  res.json(UpdateTitleResponse.parse(toTitleResponse(updated)));
});

router.delete("/admin/titles/:id", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, DeleteTitleHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const parsed = DeleteTitleParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [deleted] = await db
    .delete(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, parsed.data.id))
    .returning({ id: catalogTitlesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Title not found" });
    return;
  }
  res.status(204).end();
});

function toDateOnlyString(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

router.post("/admin/titles/:id/episodes", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, CreateEpisodeHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const params = CreateEpisodeParams.safeParse(req.params);
  const body = CreateEpisodeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : (body as { error: { message: string } }).error.message,
    });
    return;
  }

  const [title] = await db
    .select({ id: catalogTitlesTable.id })
    .from(catalogTitlesTable)
    .where(eq(catalogTitlesTable.id, params.data.id))
    .limit(1);
  if (!title) {
    res.status(404).json({ error: "Title not found" });
    return;
  }

  try {
    const [episode] = await db
      .insert(catalogEpisodesTable)
      .values({
        titleId: title.id,
        seasonNumber: body.data.seasonNumber,
        episodeNumber: body.data.episodeNumber,
        title: body.data.title,
        synopsis: body.data.synopsis ?? null,
        airDate: toDateOnlyString(body.data.airDate),
        sourceUrl: body.data.sourceUrl,
      })
      .returning();
    if (!episode) {
      res.status(400).json({ error: "Unable to create episode" });
      return;
    }
    res.status(201).json(CreateEpisodeResponse.parse(episode));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create episode";
    const isConflict = message.includes("duplicate key") || message.includes("unique");
    res.status(isConflict ? 409 : 400).json({
      error: isConflict
        ? "An episode with this season/episode number already exists"
        : message,
    });
  }
});

router.put("/admin/episodes/:episodeId", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, UpdateEpisodeHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const params = UpdateEpisodeParams.safeParse(req.params);
  const body = UpdateEpisodeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : (body as { error: { message: string } }).error.message,
    });
    return;
  }

  const updates: Partial<typeof catalogEpisodesTable.$inferInsert> = {};
  if (body.data.seasonNumber !== undefined) updates.seasonNumber = body.data.seasonNumber;
  if (body.data.episodeNumber !== undefined) updates.episodeNumber = body.data.episodeNumber;
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.synopsis !== undefined) updates.synopsis = body.data.synopsis;
  if (body.data.airDate !== undefined) updates.airDate = toDateOnlyString(body.data.airDate);

  const [updated] = await db
    .update(catalogEpisodesTable)
    .set(updates)
    .where(eq(catalogEpisodesTable.id, params.data.episodeId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }
  res.json(UpdateEpisodeResponse.parse(updated));
});

router.delete("/admin/episodes/:episodeId", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, DeleteEpisodeHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const parsed = DeleteEpisodeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [deleted] = await db
    .delete(catalogEpisodesTable)
    .where(eq(catalogEpisodesTable.id, parsed.data.episodeId))
    .returning({ id: catalogEpisodesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }
  res.status(204).end();
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

type MediaAdminHeaderSchema = {
  safeParse: (input: unknown) =>
    | { success: true; data: { "x-media-admin-key": string } }
    | { success: false; error: { message: string } };
};

function hasValidMediaAdminKey(
  req: Request,
  schema: MediaAdminHeaderSchema,
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

router.delete("/admin/media-assets/:assetId", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, DeleteMediaAssetHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const parsed = DeleteMediaAssetParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [deleted] = await db
    .delete(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, parsed.data.assetId))
    .returning({ id: mediaAssetsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Media asset not found" });
    return;
  }
  res.status(204).end();
});

router.get("/admin/media-ingestions", async (req, res): Promise<void> => {
  if (!hasValidMediaAdminKey(req, ListMediaIngestionsHeader)) {
    res.status(401).json({ error: "Invalid media admin key" });
    return;
  }
  const parsed = ListMediaIngestionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, page, pageSize } = parsed.data;
  const { items, total } = await listMediaIngestionJobs({ status, page, pageSize });
  res.json(
    ListMediaIngestionsResponse.parse({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }),
  );
});

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

router.post(
  "/admin/media-ingestions/:jobId/retry",
  async (req, res): Promise<void> => {
    if (!hasValidMediaAdminKey(req, RetryMediaIngestionHeader)) {
      res.status(401).json({ error: "Invalid media admin key" });
      return;
    }
    const parsed = RetryMediaIngestionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await retryMediaIngestionJob(parsed.data.jobId);
    if (result.kind === "not-found") {
      res.status(404).json({ error: "Media ingestion job not found" });
      return;
    }
    if (result.kind === "not-failed") {
      res.status(409).json({ error: "Job is not in a failed state" });
      return;
    }
    res.status(202).json(RetryMediaIngestionResponse.parse(result.job));
  },
);

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

const catalogImportRateLimit = rateLimit({ windowMs: 60_000, max: 5 });

router.post("/catalog/import", catalogImportRateLimit, async (req, res): Promise<void> => {
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