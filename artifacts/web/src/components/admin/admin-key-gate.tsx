"use client";

import { useState, type ReactNode } from "react";
import { useAdminKey } from "@/lib/use-admin-key";

export function AdminKeyGate({
  children,
}: {
  children: (key: string) => ReactNode;
}) {
  const { key, setKey, hydrated } = useAdminKey();
  const [draft, setDraft] = useState("");

  if (!hydrated) return null;

  if (!key) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setKey(draft.trim());
        }}
        className="max-w-sm space-y-3"
      >
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
          Media admin key
          <input
            type="password"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="x-media-admin-key"
            className="border-b border-line bg-transparent py-1 text-sm text-text focus:border-marquee focus:outline-none"
          />
        </label>
        <p className="text-sm text-muted-dim">
          This matches <code>MEDIA_ADMIN_KEY</code> on the API server. It&apos;s
          kept only in this browser.
        </p>
        <button
          type="submit"
          className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper"
        >
          Continue
        </button>
      </form>
    );
  }

  return (
    <div>
      <button
        onClick={() => setKey("")}
        className="mb-8 text-xs text-muted-dim hover:text-rose"
      >
        Forget admin key
      </button>
      {children(key)}
    </div>
  );
}
