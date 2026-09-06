import type { TitleSummary } from "@workspace/api-client-react";
import { TitleCard } from "@/components/title-card";

export function TitleGrid({
  titles,
  ranked = false,
}: {
  titles: TitleSummary[];
  ranked?: boolean;
}) {
  if (titles.length === 0) {
    return (
      <p className="py-16 text-center text-muted">
        Nothing here yet. Try a different search or filter.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title, index) => (
        <TitleCard
          key={title.id}
          title={title}
          rank={ranked ? index + 1 : undefined}
        />
      ))}
    </div>
  );
}
