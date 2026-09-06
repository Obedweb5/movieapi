"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateMediaIngestion,
  useListMediaIngestions,
  useRegisterMediaAsset,
  useRetryMediaIngestion,
  type MediaAssetInput,
} from "@workspace/api-client-react";

function adminHeaders(key: string) {
  return { request: { headers: { "x-media-admin-key": key } } };
}

export function IngestManager({ adminKey }: { adminKey: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);

  const jobsQuery = useListMediaIngestions(
    { pageSize: 30 },
    {
      query: { queryKey: ["admin-ingestions"], refetchInterval: 5000 },
      ...adminHeaders(adminKey),
    },
  );

  const invalidateJobs = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-ingestions"] });

  const [ingestForm, setIngestForm] = useState({
    titleId: "",
    sourceRelativePath: "",
  });

  const createIngestion = useCreateMediaIngestion({
    ...adminHeaders(adminKey),
    mutation: {
      onSuccess: () => {
        setStatus("Ingestion job queued.");
        invalidateJobs();
      },
      onError: (error) => setStatus(`Couldn't queue ingestion: ${error}`),
    },
  });

  const retryIngestion = useRetryMediaIngestion({
    ...adminHeaders(adminKey),
    mutation: { onSuccess: invalidateJobs },
  });

  const [assetForm, setAssetForm] = useState<MediaAssetInput>({
    titleId: 0,
    kind: "video",
    label: "",
    relativePath: "",
    mimeType: "video/mp4",
  });

  const registerAsset = useRegisterMediaAsset({
    ...adminHeaders(adminKey),
    mutation: {
      onSuccess: () => setStatus("Media asset registered."),
      onError: (error) => setStatus(`Couldn't register asset: ${error}`),
    },
  });

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div className="space-y-12">
        <div>
          <h2 className="mb-4 font-display text-xl italic text-paper">
            Queue a transcode job
          </h2>
          <p className="mb-4 text-sm text-muted-dim">
            Reads a source file from <code>MEDIA_LIBRARY_ROOT</code> and
            transcodes it into the qualities you register.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createIngestion.mutate({
                data: {
                  titleId: Number(ingestForm.titleId),
                  sourceRelativePath: ingestForm.sourceRelativePath,
                  qualities: [
                    { label: "720p", height: 720, bitrateKbps: 2500 },
                    { label: "1080p", height: 1080, bitrateKbps: 5000 },
                  ],
                },
              });
            }}
            className="space-y-3"
          >
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              Title ID
              <input
                required
                type="number"
                value={ingestForm.titleId}
                onChange={(e) =>
                  setIngestForm({ ...ingestForm, titleId: e.target.value })
                }
                className="admin-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              Source relative path
              <input
                required
                value={ingestForm.sourceRelativePath}
                onChange={(e) =>
                  setIngestForm({
                    ...ingestForm,
                    sourceRelativePath: e.target.value,
                  })
                }
                placeholder="films/example.mkv"
                className="admin-input"
              />
            </label>
            <button
              type="submit"
              disabled={createIngestion.isPending}
              className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
            >
              Queue job (720p + 1080p)
            </button>
          </form>
        </div>

        <div>
          <h2 className="mb-4 font-display text-xl italic text-paper">
            Register a media asset directly
          </h2>
          <p className="mb-4 text-sm text-muted-dim">
            For assets that are already in their final form (manifests,
            subtitles, downloads) rather than queued for transcoding.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              registerAsset.mutate({ data: assetForm });
            }}
            className="space-y-3"
          >
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              Title ID
              <input
                required
                type="number"
                value={assetForm.titleId || ""}
                onChange={(e) =>
                  setAssetForm({ ...assetForm, titleId: Number(e.target.value) })
                }
                className="admin-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              Kind
              <select
                value={assetForm.kind}
                onChange={(e) =>
                  setAssetForm({
                    ...assetForm,
                    kind: e.target.value as MediaAssetInput["kind"],
                  })
                }
                className="admin-input"
              >
                <option value="manifest">Manifest</option>
                <option value="video">Video</option>
                <option value="download">Download</option>
                <option value="subtitle">Subtitle</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              Label
              <input
                required
                value={assetForm.label}
                onChange={(e) =>
                  setAssetForm({ ...assetForm, label: e.target.value })
                }
                className="admin-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              Relative path (under MEDIA_LIBRARY_ROOT)
              <input
                required
                value={assetForm.relativePath}
                onChange={(e) =>
                  setAssetForm({ ...assetForm, relativePath: e.target.value })
                }
                className="admin-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
              MIME type
              <input
                required
                value={assetForm.mimeType}
                onChange={(e) =>
                  setAssetForm({ ...assetForm, mimeType: e.target.value })
                }
                className="admin-input"
              />
            </label>
            <button
              type="submit"
              disabled={registerAsset.isPending}
              className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper disabled:opacity-50"
            >
              Register asset
            </button>
          </form>
        </div>

        {status && <p className="text-sm text-muted-dim">{status}</p>}
      </div>

      <div>
        <h2 className="mb-4 font-display text-xl italic text-paper">
          Ingestion jobs
        </h2>
        {jobsQuery.isLoading && (
          <p className="text-sm text-muted-dim">Loading…</p>
        )}
        <ul className="rule divide-y divide-line">
          {jobsQuery.data?.items.map((job) => (
            <li key={job.id} className="py-3 text-sm">
              <div className="flex items-center justify-between">
                <span>
                  <span className="text-muted-dim">#{job.id}</span> title{" "}
                  {job.titleId} · {job.sourceRelativePath}
                </span>
                <span
                  className={
                    job.status === "failed"
                      ? "text-rose"
                      : job.status === "completed"
                        ? "text-marquee"
                        : "text-muted"
                  }
                >
                  {job.status} {job.status === "processing" && `(${job.progress}%)`}
                </span>
              </div>
              {job.status === "failed" && (
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-rose">{job.error}</span>
                  <button
                    onClick={() => retryIngestion.mutate({ jobId: job.id })}
                    className="text-xs text-marquee hover:text-paper"
                  >
                    Retry
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
