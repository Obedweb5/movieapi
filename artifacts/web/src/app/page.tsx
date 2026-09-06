import Image from "next/image";
import Link from "next/link";
import {
  listGenres,
  listTitles,
  listTrendingTitles,
} from "@workspace/api-client-react";
import { TitleGrid } from "@/components/title-grid";
import { formatGenres, formatScore, formatType } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [trending, newest, genreList] = await Promise.all([
    listTrendingTitles({ limit: 13 }),
    listTitles({ sort: "newest", pageSize: 12 }),
    listGenres(),
  ]);

  const [headline, ...rest] = trending;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {headline && (
        <section className="rule-b grid gap-8 pb-12 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col justify-end">
            <p className="text-sm uppercase tracking-[0.2em] text-marquee">
              Tonight&apos;s lead
            </p>
            <h1 className="mt-3 font-display text-5xl italic leading-[1.05] text-paper sm:text-6xl">
              {headline.title}
            </h1>
            <p className="mt-4 max-w-lg text-muted">
              {headline.synopsis ??
                "No synopsis has been catalogued for this title yet."}
            </p>
            <p className="mt-4 text-sm text-muted-dim">
              {[
                headline.year,
                formatType(headline.type),
                formatGenres(headline.genres, 3),
                headline.rating != null
                  ? `rated ${formatScore(headline.rating)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-6">
              <Link
                href={`/titles/${headline.id}`}
                className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper"
              >
                Open the programme note
              </Link>
            </div>
          </div>
          {headline.posterUrl && (
            <div className="relative aspect-[2/3] w-full max-w-xs justify-self-end overflow-hidden bg-panel md:max-w-none">
              <Image
                src={headline.posterUrl}
                alt=""
                fill
                sizes="320px"
                priority
                className="object-cover"
              />
            </div>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section className="rule-b py-12">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="font-display text-2xl italic text-paper">
              Trending this week
            </h2>
            <Link
              href="/browse?sort=popular"
              className="text-sm text-muted hover:text-marquee"
            >
              See the full list
            </Link>
          </div>
          <TitleGrid titles={rest} ranked />
        </section>
      )}

      {genreList.genres.length > 0 && (
        <section className="rule-b py-12">
          <h2 className="mb-6 font-display text-2xl italic text-paper">
            Browse by genre
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {genreList.genres.map((genre) => (
              <Link
                key={genre}
                href={`/browse?genre=${encodeURIComponent(genre)}`}
                className="border-b border-transparent text-sm text-muted hover:border-marquee hover:text-text"
              >
                {genre}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="py-12">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-display text-2xl italic text-paper">
            New to the catalogue
          </h2>
          <Link
            href="/browse?sort=newest"
            className="text-sm text-muted hover:text-marquee"
          >
            See the full list
          </Link>
        </div>
        <TitleGrid titles={newest.items} />
      </section>
    </div>
  );
}
