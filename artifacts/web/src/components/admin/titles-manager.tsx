"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateEpisode,
  useCreateTitle,
  useDeleteTitle,
  useListTitles,
  type TitleInput,
} from "@workspace/api-client-react";

function adminHeaders(key: string) {
  return { request: { headers: { "x-media-admin-key": key } } };
}

const emptyTitle: TitleInput = {
  title: "",
  type: "movie",
  sourceUrl: "",
  synopsis: "",
  year: undefined,
  genres: [],
  posterUrl: "",
  rating: undefined,
};

export function TitlesManager({ adminKey }: { adminKey: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TitleInput>(emptyTitle);
  const [genresInput, setGenresInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [episodeTitleId, setEpisodeTitleId] = useState("");

  const titlesQuery = useListTitles(
    { pageSize: 50, sort: "newest" },
    { query: { queryKey: ["admin-titles"] } },
  );

  const invalidateTitles = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-titles"] });

  const createTitle = useCreateTitle({
    ...adminHeaders(adminKey),
    mutation: {
      onSuccess: () => {
        setStatus("Title created.");
        setForm(emptyTitle);
        setGenresInput("");
        invalidateTitles();
      },
      onError: (error) => setStatus(`Couldn't create title: ${error}`),
    },
  });

  const deleteTitle = useDeleteTitle({
    ...adminHeaders(adminKey),
    mutation: {
      onSuccess: invalidateTitles,
    },
  });

  const [episodeForm, setEpisodeForm] = useState({
    seasonNumber: 1,
    episodeNumber: 1,
    title: "",
    sourceUrl: "",
  });

  const createEpisode = useCreateEpisode({
    ...adminHeaders(adminKey),
    mutation: {
      onSuccess: () => {
        setStatus("Episode added.");
        setEpisodeForm({
          seasonNumber: 1,
          episodeNumber: 1,
          title: "",
          sourceUrl: "",
        });
        invalidateTitles();
      },
      onError: (error) => setStatus(`Couldn't add episode: ${error}`),
    },
  });

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div>
        <h2 className="mb-4 font-display text-xl italic text-paper">
          Add a title
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createTitle.mutate({
              data: {
                ...form,
                genres: genresInput
                  .split(",")
                  .map((g) => g.trim())
                  .filter(Boolean),
                year: form.year ? Number(form.year) : null,
                rating: form.rating ? Number(form.rating) : null,
              },
            });
          }}
          className="space-y-3"
        >
          <Field label="Title">
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="admin-input"
            />
          </Field>
          <Field label="Type">
            <select
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as TitleInput["type"] })
              }
              className="admin-input"
            >
              <option value="movie">Film</option>
              <option value="series">Series</option>
            </select>
          </Field>
          <Field label="Source URL (unique)">
            <input
              required
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              className="admin-input"
            />
          </Field>
          <Field label="Poster URL">
            <input
              value={form.posterUrl ?? ""}
              onChange={(e) => setForm({ ...form, posterUrl: e.target.value })}
              className="admin-input"
            />
          </Field>
          <Field label="Year">
            <input
              type="number"
              value={form.year ?? ""}
              onChange={(e) =>
                setForm({ ...form, year: e.target.value ? Number(e.target.value) : null })
              }
              className="admin-input"
            />
          </Field>
          <Field label="Genres (comma separated)">
            <input
              value={genresInput}
              onChange={(e) => setGenresInput(e.target.value)}
              className="admin-input"
            />
          </Field>
          <Field label="Synopsis">
            <textarea
              value={form.synopsis ?? ""}
              onChange={(e) => setForm({ ...form, synopsis: e.target.value })}
              rows={3}
              className="admin-input"
            />
          </Field>
          <button
            type="submit"
            disabled={createTitle.isPending}
            className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
          >
            Create title
          </button>
        </form>

        <h2 className="mb-4 mt-12 font-display text-xl italic text-paper">
          Add an episode
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!episodeTitleId) return;
            createEpisode.mutate({
              id: Number(episodeTitleId),
              data: episodeForm,
            });
          }}
          className="space-y-3"
        >
          <Field label="Title ID">
            <input
              required
              type="number"
              value={episodeTitleId}
              onChange={(e) => setEpisodeTitleId(e.target.value)}
              className="admin-input"
            />
          </Field>
          <div className="flex gap-3">
            <Field label="Season">
              <input
                type="number"
                min={0}
                value={episodeForm.seasonNumber}
                onChange={(e) =>
                  setEpisodeForm({
                    ...episodeForm,
                    seasonNumber: Number(e.target.value),
                  })
                }
                className="admin-input"
              />
            </Field>
            <Field label="Episode">
              <input
                type="number"
                min={0}
                value={episodeForm.episodeNumber}
                onChange={(e) =>
                  setEpisodeForm({
                    ...episodeForm,
                    episodeNumber: Number(e.target.value),
                  })
                }
                className="admin-input"
              />
            </Field>
          </div>
          <Field label="Episode title">
            <input
              required
              value={episodeForm.title}
              onChange={(e) =>
                setEpisodeForm({ ...episodeForm, title: e.target.value })
              }
              className="admin-input"
            />
          </Field>
          <Field label="Source URL">
            <input
              required
              value={episodeForm.sourceUrl}
              onChange={(e) =>
                setEpisodeForm({ ...episodeForm, sourceUrl: e.target.value })
              }
              className="admin-input"
            />
          </Field>
          <button
            type="submit"
            disabled={createEpisode.isPending}
            className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
          >
            Add episode
          </button>
        </form>

        {status && <p className="mt-4 text-sm text-muted-dim">{status}</p>}
      </div>

      <div>
        <h2 className="mb-4 font-display text-xl italic text-paper">
          Existing titles
        </h2>
        {titlesQuery.isLoading && (
          <p className="text-sm text-muted-dim">Loading…</p>
        )}
        <ul className="rule divide-y divide-line">
          {titlesQuery.data?.items.map((title) => (
            <li key={title.id} className="flex items-center justify-between py-3 text-sm">
              <span>
                <span className="text-muted-dim">#{title.id}</span>{" "}
                {title.title}{" "}
                <span className="text-muted-dim">({title.year ?? "—"})</span>
              </span>
              <button
                onClick={() => {
                  if (confirm(`Delete "${title.title}"?`)) {
                    deleteTitle.mutate({ id: title.id });
                  }
                }}
                className="text-xs text-rose hover:text-paper"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
      {label}
      {children}
    </label>
  );
}
