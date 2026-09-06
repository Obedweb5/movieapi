"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import {
  useListContinueWatching,
  useListWatchlist,
} from "@workspace/api-client-react";
import { TitleGrid } from "@/components/title-grid";
import { formatDuration } from "@/lib/format";

function ContinueWatchingSection() {
  const query = useListContinueWatching({ limit: 20 });

  if (query.isLoading) {
    return <p className="text-sm text-muted-dim">Loading…</p>;
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-dim">
        Nothing in progress. Start watching something and it&apos;ll show up
        here.
      </p>
    );
  }

  return (
    <ul className="rule divide-y divide-line">
      {items.map(({ title, progress }) => (
        <li key={`${title.id}-${progress.episodeId ?? "movie"}`} className="py-4">
          <Link
            href={`/titles/${title.id}`}
            className="font-display text-lg italic text-paper hover:text-marquee"
          >
            {title.title}
          </Link>
          <p className="mt-1 text-sm text-muted-dim">
            {formatDuration(progress.positionSeconds)}
            {progress.durationSeconds
              ? ` of ${formatDuration(progress.durationSeconds)}`
              : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function WatchlistSection() {
  const query = useListWatchlist();

  if (query.isLoading) {
    return <p className="text-sm text-muted-dim">Loading…</p>;
  }

  return <TitleGrid titles={query.data ?? []} />;
}

export default function MyListPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-10 font-display text-3xl italic text-paper">
        My list
      </h1>

      <SignedOut>
        <p className="text-muted">
          <SignInButton mode="modal">
            <button className="border-b border-marquee text-marquee hover:text-paper">
              Sign in
            </button>
          </SignInButton>{" "}
          to see your watchlist and continue watching.
        </p>
      </SignedOut>

      <SignedIn>
        <section className="rule-b pb-10">
          <h2 className="mb-6 font-display text-2xl italic text-paper">
            Continue watching
          </h2>
          <ContinueWatchingSection />
        </section>

        <section className="pt-10">
          <h2 className="mb-6 font-display text-2xl italic text-paper">
            Watchlist
          </h2>
          <WatchlistSection />
        </section>
      </SignedIn>
    </div>
  );
}
