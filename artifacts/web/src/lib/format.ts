import type { TitleSummary } from "@workspace/api-client-react";

export function formatType(type: TitleSummary["type"]): string {
  return type === "series" ? "Series" : "Film";
}

export function formatGenres(genres: string[], max = 3): string {
  return genres.slice(0, max).join(", ");
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "—";
  return score.toFixed(1);
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
