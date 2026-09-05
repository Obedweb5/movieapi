import {
  date,
  integer,
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