import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetTitleParams,
  GetTitleResponse,
  ImportCatalogMetadataBody,
  ImportCatalogMetadataResponse,
  ListTitlesQueryParams,
  ListTitlesResponse,
} from "@workspace/api-zod";
import {
  catalogEpisodesTable,
  catalogTitlesTable,
  db,
} from "@workspace/db";
import { scrapePublicCatalog } from "../lib/catalog-source";

const router: IRouter = Router();

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