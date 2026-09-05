import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  serial,
  boolean,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  pgTable,
} from "drizzle-orm/pg-core";

export const catalogTitlesTable = pgTable(
  "catalog_titles",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 300 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(),
    posterUrl: text("poster_url"),
    synopsis: text("synopsis"),
    year: integer("year"),
    genres: text("genres").array().notNull().default([]),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    sourceUrl: text("source_url").notNull(),
    lastSyncedAt: timestamp("last_synced_at", {
      withTimezone: true,
    }).notNull().defaultNow(),
  },
  (table) => ({
    sourceUrlIndex: uniqueIndex("catalog_titles_source_url_idx").on(
      table.sourceUrl,
    ),
  }),
);

export const catalogEpisodesTable = pgTable(
  "catalog_episodes",
  {
    id: serial("id").primaryKey(),
    titleId: integer("title_id")
      .notNull()
      .references(() => catalogTitlesTable.id, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    synopsis: text("synopsis"),
    airDate: date("air_date"),
    sourceUrl: text("source_url").notNull(),
  },
  (table) => ({
    episodeIndex: uniqueIndex("catalog_episodes_identity_idx").on(
      table.titleId,
      table.seasonNumber,
      table.episodeNumber,
    ),
  }),
);

export const mediaAssetsTable = pgTable(
  "media_assets",
  {
    id: serial("id").primaryKey(),
    titleId: integer("title_id")
      .notNull()
      .references(() => catalogTitlesTable.id, { onDelete: "cascade" }),
    episodeId: integer("episode_id").references(() => catalogEpisodesTable.id, {
      onDelete: "cascade",
    }),
    kind: varchar("kind", { length: 20 }).notNull(),
    label: varchar("label", { length: 50 }).notNull(),
    relativePath: text("relative_path").notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    language: varchar("language", { length: 12 }),
    width: integer("width"),
    height: integer("height"),
    bitrateKbps: integer("bitrate_kbps"),
    isDownloadable: boolean("is_downloadable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    assetIdentityIndex: uniqueIndex("media_assets_identity_idx").on(
      table.titleId,
      table.episodeId,
      table.kind,
      table.label,
    ),
  }),
);

export type MediaIngestionQuality = {
  label: string;
  height: number;
  bitrateKbps: number;
};

export type MediaIngestionSubtitle = {
  relativePath: string;
  label: string;
  language?: string;
};

export const mediaIngestionJobsTable = pgTable(
  "media_ingestion_jobs",
  {
    id: serial("id").primaryKey(),
    titleId: integer("title_id")
      .notNull()
      .references(() => catalogTitlesTable.id, { onDelete: "cascade" }),
    episodeId: integer("episode_id").references(() => catalogEpisodesTable.id, {
      onDelete: "cascade",
    }),
    sourceRelativePath: text("source_relative_path").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    qualities: jsonb("qualities")
      .$type<MediaIngestionQuality[]>()
      .notNull(),
    subtitles: jsonb("subtitles")
      .$type<MediaIngestionSubtitle[]>()
      .notNull()
      .default([]),
    includeDownloads: boolean("include_downloads").notNull().default(true),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    statusIndex: index("media_ingestion_jobs_status_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);