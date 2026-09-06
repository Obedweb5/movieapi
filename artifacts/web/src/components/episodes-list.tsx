import type { Episode } from "@workspace/api-client-react";

export function EpisodesList({ episodes }: { episodes: Episode[] }) {
  if (episodes.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-dim">
        No episodes catalogued yet.
      </p>
    );
  }

  const seasons = new Map<number, Episode[]>();
  for (const episode of episodes) {
    const list = seasons.get(episode.seasonNumber) ?? [];
    list.push(episode);
    seasons.set(episode.seasonNumber, list);
  }

  return (
    <div className="mt-6 space-y-8">
      {[...seasons.entries()]
        .sort(([a], [b]) => a - b)
        .map(([season, items]) => (
          <div key={season}>
            <h3 className="mb-3 text-sm uppercase tracking-wide text-muted-dim">
              Season {season}
            </h3>
            <ul className="rule divide-y divide-line">
              {items
                .sort((a, b) => a.episodeNumber - b.episodeNumber)
                .map((episode) => (
                  <li
                    key={episode.id}
                    className="flex items-baseline gap-4 py-3"
                  >
                    <span className="w-6 shrink-0 text-sm text-muted-dim">
                      {episode.episodeNumber}
                    </span>
                    <div>
                      <p className="text-sm text-text">{episode.title}</p>
                      {episode.synopsis && (
                        <p className="mt-1 text-sm text-muted-dim">
                          {episode.synopsis}
                        </p>
                      )}
                    </div>
                    {episode.airDate && (
                      <span className="ml-auto shrink-0 text-xs text-muted-dim">
                        {episode.airDate}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
