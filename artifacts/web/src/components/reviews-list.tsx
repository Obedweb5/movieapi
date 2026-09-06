import type { Rating } from "@workspace/api-client-react";
import { formatDate } from "@/lib/format";

export function ReviewsList({ ratings }: { ratings: Rating[] }) {
  if (ratings.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-dim">
        No reviews yet — be the first.
      </p>
    );
  }

  return (
    <ul className="mt-6 space-y-6">
      {ratings.map((rating) => (
        <li key={rating.id} className="rule pt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-display text-lg italic text-marquee">
              {rating.score}/10
            </span>
            <span className="text-muted-dim">
              {formatDate(rating.updatedAt)}
            </span>
          </div>
          {rating.review && (
            <p className="mt-2 text-sm text-muted">{rating.review}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
