"use client";

import { useState } from "react";
import { AdminKeyGate } from "@/components/admin/admin-key-gate";
import { TitlesManager } from "@/components/admin/titles-manager";
import { IngestManager } from "@/components/admin/ingest-manager";
import { ImportForm } from "@/components/admin/import-form";
import clsx from "clsx";

const tabs = [
  { id: "titles", label: "Titles & episodes" },
  { id: "ingest", label: "Media & ingestion" },
  { id: "import", label: "Catalog import" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>("titles");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-sm uppercase tracking-[0.2em] text-marquee">
        Backstage
      </p>
      <h1 className="mt-2 font-display text-3xl italic text-paper">
        Admin
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Manage the catalog, register owned media, and queue transcode jobs.
        These actions call the API server directly and are gated by the
        media admin key, not by your Clerk sign-in.
      </p>

      <div className="rule-b mt-8 flex gap-8 pb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "border-b pb-1 text-sm",
              tab === t.id
                ? "border-marquee text-text"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-10">
        <AdminKeyGate>
          {(key) => (
            <>
              {tab === "titles" && <TitlesManager adminKey={key} />}
              {tab === "ingest" && <IngestManager adminKey={key} />}
              {tab === "import" && <ImportForm />}
            </>
          )}
        </AdminKeyGate>
      </div>
    </div>
  );
}
