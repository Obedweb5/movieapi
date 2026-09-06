"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { useUpsertTitleRating } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";

export function RatingWidget({
  titleId,
  averageScore,
  ratingCount,
}: {
  titleId: number;
  averageScore: number | null;
  ratingCount: number;
}) {
  const [score, setScore] = useState(0);
  const [review, setReview] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const queryClient = useQueryClient();

  const upsert = useUpsertTitleRating({
    mutation: {
      onSuccess: () => {
        setSubmitted(true);
        void queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            typeof q.queryKey[0] === "string" &&
            q.queryKey[0].includes(`/titles/${titleId}/ratings`),
        });
      },
    },
  });

  return (
    <div className="rule pt-8">
      <div className="flex items-baseline gap-4">
        <h2 className="font-display text-2xl italic text-paper">Reviews</h2>
        {averageScore !== null && (
          <p className="text-sm text-muted-dim">
            Average {averageScore.toFixed(1)} / 10 · {ratingCount}{" "}
            {ratingCount === 1 ? "review" : "reviews"}
          </p>
        )}
      </div>

      <SignedOut>
        <p className="mt-4 text-sm text-muted">
          <SignInButton mode="modal">
            <button className="border-b border-marquee text-marquee hover:text-paper">
              Sign in
            </button>
          </SignInButton>{" "}
          to leave a rating.
        </p>
      </SignedOut>

      <SignedIn>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (score < 1) return;
            upsert.mutate({
              id: titleId,
              data: { score, review: review.trim() || null },
            });
          }}
          className="mt-4 max-w-md space-y-3"
        >
          <div className="flex gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => setScore(value)}
                aria-label={`Rate ${value} out of 10`}
                className="p-0.5"
              >
                <Star
                  className={clsx(
                    "h-4 w-4",
                    value <= score
                      ? "fill-marquee text-marquee"
                      : "text-line",
                  )}
                />
              </button>
            ))}
          </div>
          <textarea
            value={review}
            onChange={(event) => setReview(event.target.value)}
            placeholder="Write a short review (optional)"
            rows={3}
            className="w-full border border-line bg-transparent p-2 text-sm text-text placeholder:text-muted-dim focus:border-marquee focus:outline-none"
          />
          <button
            type="submit"
            disabled={score < 1 || upsert.isPending}
            className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
          >
            {submitted ? "Update rating" : "Submit rating"}
          </button>
          {upsert.isError && (
            <p className="text-sm text-rose">
              Couldn&apos;t save your rating. Try again.
            </p>
          )}
          {submitted && !upsert.isError && (
            <p className="text-sm text-muted-dim">Thanks for rating this.</p>
          )}
        </form>
      </SignedIn>
    </div>
  );
}
