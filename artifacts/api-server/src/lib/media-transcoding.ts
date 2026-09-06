import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, asc, desc, eq, or } from "drizzle-orm";
import {
  db,
  mediaAssetsTable,
  mediaIngestionJobsTable,
  type MediaIngestionQuality,
} from "@workspace/db";
import { logger } from "./logger";
import { resolveMediaPath } from "./media-signing";

const execFileAsync = promisify(execFile);
const DEFAULT_QUALITIES: MediaIngestionQuality[] = [
  { label: "1080p", height: 1080, bitrateKbps: 5000 },
  { label: "720p", height: 720, bitrateKbps: 2800 },
  { label: "480p", height: 480, bitrateKbps: 1400 },
];
const MAX_QUALITIES = 8;

type ProbeResult = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    bit_rate?: string;
  }>;
};

type IngestionJob = typeof mediaIngestionJobsTable.$inferSelect;

let workerRunning = false;
let workerScheduled = false;

function ffmpegBinary(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

function ffprobeBinary(): string {
  return process.env.FFPROBE_PATH ?? "ffprobe";
}

function parseConfiguredQualities(): MediaIngestionQuality[] {
  const configured = process.env.MEDIA_TRANSCODE_QUALITIES;
  if (!configured) return DEFAULT_QUALITIES;

  const parsed = configured
    .split(",")
    .map((entry) => {
      const [heightText, bitrateText] = entry.trim().split(":");
      const height = Number(heightText);
      const bitrateKbps = Number(bitrateText);
      return {
        label: `${height}p`,
        height,
        bitrateKbps,
      };
    })
    .filter(
      (quality) =>
        Number.isInteger(quality.height) &&
        quality.height >= 144 &&
        quality.height <= 4320 &&
        Number.isInteger(quality.bitrateKbps) &&
        quality.bitrateKbps >= 100 &&
        quality.bitrateKbps <= 50000,
    );

  return parsed.length > 0 ? parsed.slice(0, MAX_QUALITIES) : DEFAULT_QUALITIES;
}

export function defaultTranscodeQualities(): MediaIngestionQuality[] {
  return parseConfiguredQualities();
}

function normalizeQuality(
  quality: Partial<MediaIngestionQuality>,
): MediaIngestionQuality {
  const label = quality.label?.trim();
  const height = quality.height;
  const bitrateKbps = quality.bitrateKbps;
  if (
    !label ||
    label.length > 50 ||
    /[/\\]/.test(label) ||
    !Number.isInteger(height) ||
    height === undefined ||
    height < 144 ||
    height > 4320 ||
    !Number.isInteger(bitrateKbps) ||
    bitrateKbps === undefined ||
    bitrateKbps < 100 ||
    bitrateKbps > 50000
  ) {
    throw new Error(
      "Each quality needs a label, a height from 144 to 4320, and a bitrate from 100 to 50000 Kbps",
    );
  }
  return {
    label,
    height,
    bitrateKbps,
  };
}

export function normalizeTranscodeQualities(
  qualities?: Partial<MediaIngestionQuality>[],
): MediaIngestionQuality[] {
  const values = qualities?.length
    ? qualities.map(normalizeQuality)
    : defaultTranscodeQualities();
  if (values.length > MAX_QUALITIES) {
    throw new Error(`A maximum of ${MAX_QUALITIES} qualities is supported`);
  }
  const seenHeights = new Set<number>();
  const seenLabels = new Set<string>();
  for (const quality of values) {
    if (seenHeights.has(quality.height)) {
      throw new Error("Each quality must use a unique height");
    }
    if (seenLabels.has(quality.label)) {
      throw new Error("Each quality must use a unique label");
    }
    seenHeights.add(quality.height);
    seenLabels.add(quality.label);
  }
  return values.sort((a, b) => b.height - a.height);
}

function normalizeSubtitles(
  subtitles: Array<{
    relativePath: string;
    label: string;
    language?: string;
  }> = [],
) {
  return subtitles.map((subtitle) => {
    const relativePath = subtitle.relativePath.trim();
    const label = subtitle.label.trim();
    const language = subtitle.language?.trim() || undefined;
    if (
      !relativePath ||
      !label ||
      label.length > 50 ||
      (language && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))
    ) {
      throw new Error("Subtitle paths, labels, and language codes must be valid");
    }
    return { relativePath, label, ...(language ? { language } : {}) };
  });
}

async function probeSource(filePath: string): Promise<{
  width: number;
  height: number;
  bitrateKbps: number | null;
}> {
  const { stdout } = await execFileAsync(
    ffprobeBinary(),
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,bit_rate",
      "-of",
      "json",
      filePath,
    ],
    { maxBuffer: 1_000_000 },
  );
  const result = JSON.parse(stdout) as ProbeResult;
  const video = result.streams?.find(
    (stream) =>
      stream.codec_type === "video" &&
      Number.isInteger(stream.width) &&
      Number.isInteger(stream.height),
  );
  if (!video?.width || !video.height) {
    throw new Error("The source file does not contain a readable video stream");
  }
  const bitrateKbps = video.bit_rate ? Number(video.bit_rate) / 1000 : null;
  return {
    width: video.width,
    height: video.height,
    bitrateKbps:
      bitrateKbps !== null && Number.isFinite(bitrateKbps)
        ? Math.round(bitrateKbps)
        : null,
  };
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(ffmpegBinary(), ["-hide_banner", "-loglevel", "error", ...args], {
    maxBuffer: 2_000_000,
  });
}

async function updateJob(
  id: number,
  values: Partial<typeof mediaIngestionJobsTable.$inferInsert>,
) {
  await db
    .update(mediaIngestionJobsTable)
    .set(values)
    .where(eq(mediaIngestionJobsTable.id, id));
}

async function registerAsset(values: {
  titleId: number;
  episodeId: number | null;
  kind: "manifest" | "video" | "download" | "subtitle";
  label: string;
  relativePath: string;
  mimeType: string;
  language?: string | null;
  width?: number | null;
  height?: number | null;
  bitrateKbps?: number | null;
  isDownloadable?: boolean;
}) {
  const [asset] = await db
    .insert(mediaAssetsTable)
    .values({
      ...values,
      width: values.width ?? null,
      height: values.height ?? null,
      bitrateKbps: values.bitrateKbps ?? null,
      isDownloadable: values.isDownloadable ?? false,
    })
    .onConflictDoUpdate({
      target: [
        mediaAssetsTable.titleId,
        mediaAssetsTable.episodeId,
        mediaAssetsTable.kind,
        mediaAssetsTable.label,
      ],
      set: {
        relativePath: values.relativePath,
        mimeType: values.mimeType,
      language: values.language ?? null,
        width: values.width ?? null,
        height: values.height ?? null,
        bitrateKbps: values.bitrateKbps ?? null,
        isDownloadable: values.isDownloadable ?? false,
      },
    })
    .returning();
  if (!asset) throw new Error(`Unable to register ${values.label}`);
  return asset;
}

async function writeHlsMaster(
  outputDirectory: string,
  variants: Array<{
    label: string;
    width: number;
    height: number;
    bitrateKbps: number;
  }>,
) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7"];
  for (const variant of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bitrateKbps * 1000},RESOLUTION=${variant.width}x${variant.height},NAME="${variant.label}"`,
      `${variant.label}/hls/index.m3u8`,
    );
  }
  await fs.writeFile(path.join(outputDirectory, "master.m3u8"), `${lines.join("\n")}\n`);
}

async function transcodeJob(job: IngestionJob): Promise<void> {
  const sourcePath = resolveMediaPath(job.sourceRelativePath);
  const sourceStats = await fs.stat(sourcePath);
  if (!sourceStats.isFile()) throw new Error("The source path is not a file");

  const probe = await probeSource(sourcePath);
  const qualities = job.qualities
    .filter((quality) => quality.height <= probe.height)
    .sort((a, b) => b.height - a.height);
  if (qualities.length === 0) {
    throw new Error("No configured quality is smaller than or equal to the source height");
  }

  const outputRelativeDirectory = path.posix.join(
    "transcoded",
    String(job.titleId),
    String(job.id),
  );
  const outputDirectory = resolveMediaPath(outputRelativeDirectory);
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });

  const generated: Array<{
    quality: MediaIngestionQuality;
    relativePath: string;
    absolutePath: string;
  }> = [];
  for (let index = 0; index < qualities.length; index += 1) {
    const quality = qualities[index];
    const qualityDirectory = path.join(outputDirectory, quality.label);
    await fs.mkdir(qualityDirectory, { recursive: true });
    const relativePath = path.posix.join(
      outputRelativeDirectory,
      `${quality.label}.mp4`,
    );
    const absolutePath = resolveMediaPath(relativePath);
    await runFfmpeg([
      "-i",
      sourcePath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      `scale=-2:${quality.height}`,
      "-c:v",
      "libx264",
      "-preset",
      process.env.MEDIA_FFMPEG_PRESET ?? "medium",
      "-profile:v",
      "main",
      "-b:v",
      `${quality.bitrateKbps}k`,
      "-maxrate",
      `${Math.round(quality.bitrateKbps * 1.1)}k`,
      "-bufsize",
      `${quality.bitrateKbps * 2}k`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      absolutePath,
    ]);
    generated.push({ quality, relativePath, absolutePath });
    await updateJob(job.id, {
      progress: Math.round(((index + 1) / (qualities.length * 2 + 2)) * 70),
    });
  }

  for (const generatedQuality of generated) {
    const hlsDirectory = path.join(
      outputDirectory,
      generatedQuality.quality.label,
      "hls",
    );
    await fs.mkdir(hlsDirectory, { recursive: true });
    await runFfmpeg([
      "-i",
      generatedQuality.absolutePath,
      "-c",
      "copy",
      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      path.join(hlsDirectory, "segment-%03d.m4s"),
      path.join(hlsDirectory, "index.m3u8"),
    ]);
  }
  await writeHlsMaster(
    outputDirectory,
    qualities.map((quality) => ({
      ...quality,
      width: Math.max(
        2,
        Math.floor((probe.width / probe.height * quality.height) / 2) * 2,
      ),
    })),
  );

  const dashDirectory = path.join(outputDirectory, "dash");
  await fs.mkdir(dashDirectory, { recursive: true });
  const dashInputs = generated.flatMap((item) => ["-i", item.absolutePath]);
  const dashMaps = generated.flatMap((_item, index) => [
    "-map",
    `${index}:v:0`,
  ]);
  if (generated.length > 0) {
    dashMaps.push("-map", "0:a:0?");
  }
  await runFfmpeg([
    ...dashInputs,
    ...dashMaps,
    "-c",
    "copy",
    "-f",
    "dash",
    "-seg_duration",
    "6",
    "-use_template",
    "0",
    "-use_timeline",
    "0",
    "-adaptation_sets",
    "id=0,streams=v id=1,streams=a",
    "-y",
    path.join(dashDirectory, "manifest.mpd"),
  ]);

  for (const item of generated) {
    await registerAsset({
      titleId: job.titleId,
      episodeId: job.episodeId,
      kind: "video",
      label: item.quality.label,
      relativePath: item.relativePath,
      mimeType: "video/mp4",
      width: Math.round((probe.width / probe.height) * item.quality.height),
      height: item.quality.height,
      bitrateKbps: item.quality.bitrateKbps,
    });
    if (job.includeDownloads) {
      await registerAsset({
        titleId: job.titleId,
        episodeId: job.episodeId,
        kind: "download",
        label: `${item.quality.label} MP4`,
        relativePath: item.relativePath,
        mimeType: "video/mp4",
        width: Math.round((probe.width / probe.height) * item.quality.height),
        height: item.quality.height,
        bitrateKbps: item.quality.bitrateKbps,
        isDownloadable: true,
      });
    }
  }
  await registerAsset({
    titleId: job.titleId,
    episodeId: job.episodeId,
    kind: "manifest",
    label: "HLS adaptive",
    relativePath: path.posix.join(outputRelativeDirectory, "master.m3u8"),
    mimeType: "application/vnd.apple.mpegurl",
  });
  await registerAsset({
    titleId: job.titleId,
    episodeId: job.episodeId,
    kind: "manifest",
    label: "DASH adaptive",
    relativePath: path.posix.join(outputRelativeDirectory, "dash", "manifest.mpd"),
    mimeType: "application/dash+xml",
  });

  for (const subtitle of job.subtitles) {
    const subtitlePath = resolveMediaPath(subtitle.relativePath);
    const subtitleStats = await fs.stat(subtitlePath);
    if (!subtitleStats.isFile()) throw new Error(`Subtitle is not a file: ${subtitle.label}`);
    await registerAsset({
      titleId: job.titleId,
      episodeId: job.episodeId,
      kind: "subtitle",
      label: subtitle.label,
      relativePath: subtitle.relativePath,
      mimeType: subtitle.relativePath.toLowerCase().endsWith(".vtt")
        ? "text/vtt"
        : "application/x-subrip",
      language: subtitle.language ?? null,
    });
  }
}

async function processJob(jobId: number): Promise<void> {
  const [job] = await db
    .select()
    .from(mediaIngestionJobsTable)
    .where(eq(mediaIngestionJobsTable.id, jobId))
    .limit(1);
  if (!job) return;

  await updateJob(job.id, {
    status: "processing",
    progress: 1,
    startedAt: new Date(),
    error: null,
  });
  try {
    await transcodeJob(job);
    await updateJob(job.id, {
      status: "completed",
      progress: 100,
      completedAt: new Date(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcoding failed";
    logger.error({ err: error, jobId }, "Media ingestion failed");
    await updateJob(job.id, { status: "failed", error: message, progress: 0 });
  }
}

async function drainQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  workerScheduled = false;
  try {
    let [job] = await db
      .select()
      .from(mediaIngestionJobsTable)
      .where(eq(mediaIngestionJobsTable.status, "queued"))
      .orderBy(asc(mediaIngestionJobsTable.createdAt))
      .limit(1);
    while (job) {
      await processJob(job.id);
      const [nextJob] = await db
        .select()
        .from(mediaIngestionJobsTable)
        .where(eq(mediaIngestionJobsTable.status, "queued"))
        .orderBy(asc(mediaIngestionJobsTable.createdAt))
        .limit(1);
      if (!nextJob) break;
      job = nextJob;
    }
  } finally {
    workerRunning = false;
  }
}

function scheduleDrain() {
  if (workerScheduled) return;
  workerScheduled = true;
  setImmediate(() => {
    void drainQueue().catch((error) => {
      workerScheduled = false;
      logger.error({ err: error }, "Media ingestion queue failed");
    });
  });
}

export async function enqueueMediaIngestion(input: {
  titleId: number;
  episodeId: number | null;
  sourceRelativePath: string;
  qualities?: Partial<MediaIngestionQuality>[];
  subtitles?: Array<{
    relativePath: string;
    label: string;
    language?: string;
  }>;
  includeDownloads: boolean;
}) {
  const sourceRelativePath = input.sourceRelativePath.trim();
  if (!sourceRelativePath) throw new Error("A source relative path is required");
  resolveMediaPath(sourceRelativePath);
  const qualities = normalizeTranscodeQualities(input.qualities);
  const subtitles = normalizeSubtitles(input.subtitles);
  for (const subtitle of subtitles) resolveMediaPath(subtitle.relativePath);

  const [job] = await db
    .insert(mediaIngestionJobsTable)
    .values({
      titleId: input.titleId,
      episodeId: input.episodeId,
      sourceRelativePath,
      qualities,
      subtitles,
      includeDownloads: input.includeDownloads,
    })
    .returning();
  if (!job) throw new Error("Unable to create media ingestion job");
  scheduleDrain();
  return job;
}

export async function resumeMediaIngestionQueue(): Promise<void> {
  await db
    .update(mediaIngestionJobsTable)
    .set({ status: "queued", error: null })
    .where(
      or(
        eq(mediaIngestionJobsTable.status, "processing"),
        eq(mediaIngestionJobsTable.status, "queued"),
      ),
    );
  scheduleDrain();
}

export async function getMediaIngestionJob(jobId: number) {
  const [job] = await db
    .select()
    .from(mediaIngestionJobsTable)
    .where(eq(mediaIngestionJobsTable.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function listMediaIngestionJobs(input: {
  status?: "queued" | "processing" | "completed" | "failed";
  page: number;
  pageSize: number;
}) {
  const filters = input.status
    ? [eq(mediaIngestionJobsTable.status, input.status)]
    : [];
  const rows = await db
    .select()
    .from(mediaIngestionJobsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(mediaIngestionJobsTable.createdAt));
  const total = rows.length;
  const start = (input.page - 1) * input.pageSize;
  const items = rows.slice(start, start + input.pageSize);
  return { items, total };
}

export async function retryMediaIngestionJob(jobId: number) {
  const job = await getMediaIngestionJob(jobId);
  if (!job) return { kind: "not-found" as const };
  if (job.status !== "failed") return { kind: "not-failed" as const };

  const [updated] = await db
    .update(mediaIngestionJobsTable)
    .set({
      status: "queued",
      progress: 0,
      error: null,
      startedAt: null,
      completedAt: null,
    })
    .where(eq(mediaIngestionJobsTable.id, jobId))
    .returning();
  if (!updated) return { kind: "not-found" as const };
  scheduleDrain();
  return { kind: "ok" as const, job: updated };
}
