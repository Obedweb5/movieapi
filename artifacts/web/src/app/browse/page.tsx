import type { Metadata } from "next";
import {
  listGenres,
  listTitles,
  type ListTitlesSort,
  type ListTitlesType,
} from "@workspace/api-client-react";
import { FiltersBar } from "@/components/filters-bar";
import { TitleGrid } from "@/components/title-grid";
import { Pagination } from "@/components/pagination";

export const metadata: Metadata = {
  title: "Browse the programme",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = first(params.query) || undefined;
  const type = first(params.type) as ListTitlesType | undefined;
  const genre = first(params.genre) || undefined;
  const sort = (first(params.sort) as ListTitlesSort | undefined) ?? "newest";
  const page = Number(first(params.page) ?? "1") || 1;

  const [result, genreList] = await Promise.all([
    listTitles({
      query,
      type: type || undefined,
      genre,
      sort,
      page,
      pageSize: 24,
    }),
    listGenres(),
  ]);

  const buildHref = (nextPage: number) => {
    const usp = new URLSearchParams();
    if (query) usp.set("query", query);
    if (type) usp.set("type", type);
    if (genre) usp.set("genre", genre);
    if (sort) usp.set("sort", sort);
    usp.set("page", String(nextPage));
    return `/browse?${usp.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-6 font-display text-3xl italic text-paper">
        {query ? `Results for “${query}”` : "The full programme"}
      </h1>

      <FiltersBar
        genres={genreList.genres}
        current={{ query, type, genre, sort }}
      />

      <p className="py-6 text-sm text-muted-dim">
        {result.total} {result.total === 1 ? "title" : "titles"}
      </p>

      <TitleGrid titles={result.items} />

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={buildHref}
      />
    </div>
  );
}
