import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { InferSelectModel } from "drizzle-orm";
import { mediaAssetsTable } from "@workspace/db";

type MediaAsset = InferSelectModel<typeof mediaAssetsTable>;

const TOKEN_TTL_SECONDS = 60 * 60;

function signingSecret(): string {
  const secret = process.env.MEDIA_SIGNING_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("MEDIA_SIGNING_SECRET or SESSION_SECRET must be configured");
  }
  return secret;
}

export function createMediaToken(assetId: number): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  const payload = Buffer.from(
    JSON.stringify({ assetId, exp: Math.floor(expiresAt.getTime() / 1000) }),
  ).toString("base64url");
  const signature = createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}

export function verifyMediaToken(token: string, assetId: number): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  try {
    const expectedSignature = createHmac("sha256", signingSecret())
      .update(payload)
      .digest("base64url");
    const provided = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return false;
    }

    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { assetId?: number; exp?: number };
    return (
      parsed.assetId === assetId &&
      typeof parsed.exp === "number" &&
      parsed.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function resolveMediaPath(relativePath: string): string {
  const root = process.env.MEDIA_LIBRARY_ROOT;
  if (!root) throw new Error("MEDIA_LIBRARY_ROOT must be configured");
  if (path.isAbsolute(relativePath)) {
    throw new Error("Media paths must be relative to MEDIA_LIBRARY_ROOT");
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Media path escapes MEDIA_LIBRARY_ROOT");
  }
  return resolvedPath;
}

export function publicMediaAsset(asset: MediaAsset) {
  return {
    id: asset.id,
    titleId: asset.titleId,
    episodeId: asset.episodeId,
    kind: asset.kind as "manifest" | "video" | "download" | "subtitle",
    label: asset.label,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    bitrateKbps: asset.bitrateKbps,
    isDownloadable: asset.isDownloadable,
  };
}

export function signedMediaAsset(
  asset: MediaAsset,
  basePath = "/api",
) {
  const { token, expiresAt } = createMediaToken(asset.id);
  return {
    assetId: asset.id,
    label: asset.label,
    url: `${basePath}/media/assets/${asset.id}/${token}`,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    bitrateKbps: asset.bitrateKbps,
    expiresAt,
  };
}