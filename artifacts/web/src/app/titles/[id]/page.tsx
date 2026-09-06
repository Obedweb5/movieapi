import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  ApiError,
  getTitle,
  listSimilarTitles,
  listTitleRatings,
} from "@workspace/api-client-react";
import { EpisodesList } from "@/components/episodes-list";
import { TitleGrid } from "@/components/title-grid";
import { WatchlistButton } from "@/components/watchlist-button";
import { RatingWidget } from "@/components/rating-widget";
import { ReviewsList } from "@/components/reviews-list";
import { formatGenres, formatScore, formatType } from "@/lib/format";

type Params = { id: string };

async function loadTitle(id: string) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) return null;

  try {
    return await getTitle(numericId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const title = await loadTitle(id);
  if (!title) return { title: "Title not found" };

  const description =
    title.synopsis ?? `${formatType(title.type)} · ${formatGenres(title.genres)}`;

  return {
    title: title.title,
    description,
    openGraph: {
      title: title.title,
      description,
      images: title.posterUrl ? [{ url: title.posterUrl }] : undefined,
    },
  };
}

export default async function TitleDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const title = await loadTitle(id);
  if (!title) notFound();

  const [similar, ratings] = await Promise.all([
    listSimilarTitles(title.id, { limit: 12 }),
    listTitleRatings(title.id, { pageSize: 10 }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="rule-b grid gap-8 pb-10 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-panel">
          {title.posterUrl && (
            <Image
              src={title.posterUrl}
              alt=""
              fill
              sizes="280px"
              priority
              className="object-cover"
            />
          )}
        </div>

        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-marquee">
            {formatType(title.type)}
          </p>
          <h1 className="mt-2 font-display text-4xl italic leading-tight text-paper">
            {title.title}
          </h1>
          <p className="mt-3 text-sm text-muted-dim">
            {[
              title.year,
              formatGenres(title.genres, 6),
              title.rating != null
                ? `catalogue rating ${formatScore(title.rating)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {title.synopsis && (
            <p className="mt-6 max-w-2xl text-muted">{title.synopsis}</p>
          )}
          <div className="mt-6">
            <WatchlistButton titleId={title.id} />
          </div>
        </div>
      </div>

      {title.type === "series" && (
        <section className="rule-b py-10">
          <h2 className="font-display text-2xl italic text-paper">
            Episodes
          </h2>
          <EpisodesList episodes={title.episodes} />
        </section>
      )}

      <section className="rule-b py-10">
        <RatingWidget
          titleId={title.id}
          averageScore={ratings.averageScore}
          ratingCount={ratings.ratingCount}
        />
        <ReviewsList ratings={ratings.items} />
      </section>

      {similar.length > 0 && (
        <section className="py-10">
          <h2 className="mb-6 font-display text-2xl italic text-paper">
            If you liked this
          </h2>
          <TitleGrid titles={similar} />
        </section>
      )}
    </div>
  );
}
