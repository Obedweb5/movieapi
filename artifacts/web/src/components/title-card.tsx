import Image from "next/image";
import Link from "next/link";
import type { TitleSummary } from "@workspace/api-client-react";
import { formatGenres, formatScore, formatType } from "@/lib/format";

export function TitleCard({
  title,
  rank,
}: {
  title: TitleSummary;
  rank?: number;
}) {
  return (
    <Link href={`/titles/${title.id}`} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden bg-panel">
        {title.posterUrl ? (
          <Image
            src={title.posterUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center font-display italic text-muted-dim">
            {title.title}
          </div>
        )}
        {rank !== undefined && (
          <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center bg-ink/80 font-display text-sm text-marquee">
            {rank}
          </span>
        )}
        {title.rating !== null && title.rating !== undefined && (
          <span className="absolute bottom-0 right-0 bg-ink/80 px-2 py-1 text-xs text-marquee">
            {formatScore(title.rating)}
          </span>
        )}
      </div>
      <h3 className="mt-2 line-clamp-1 font-display text-base leading-tight text-text group-hover:text-marquee">
        {title.title}
      </h3>
      <p className="mt-0.5 text-xs text-muted-dim">
        {[title.year, formatType(title.type), formatGenres(title.genres, 2)]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Link>
  );
}
