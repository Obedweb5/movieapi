"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import {
  useAddToWatchlist,
  useListWatchlist,
  useRemoveFromWatchlist,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export function WatchlistButton({ titleId }: { titleId: number }) {
  const queryClient = useQueryClient();

  const watchlistQuery = useListWatchlist();

  const isSaved = watchlistQuery.data?.some((title) => title.id === titleId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: watchlistQuery.queryKey });

  const add = useAddToWatchlist({ mutation: { onSuccess: invalidate } });
  const remove = useRemoveFromWatchlist({ mutation: { onSuccess: invalidate } });

  const pending = add.isPending || remove.isPending;

  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="flex items-center gap-2 border-b border-line pb-1 text-sm text-muted hover:border-marquee hover:text-text">
            <Bookmark className="h-4 w-4" />
            Sign in to save
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <button
          disabled={pending}
          onClick={() =>
            isSaved ? remove.mutate({ id: titleId }) : add.mutate({ id: titleId })
          }
          className="flex items-center gap-2 border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
        >
          {isSaved ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
          {isSaved ? "On your list" : "Add to my list"}
        </button>
      </SignedIn>
    </>
  );
}
