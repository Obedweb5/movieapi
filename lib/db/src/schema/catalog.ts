import {
  date,
  integer,
  numeric,
  serial,
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