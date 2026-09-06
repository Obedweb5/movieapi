import type { RequestHandler } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Minimal fixed-window in-memory rate limiter, keyed by client IP.
 *
 * This is intentionally dependency-free. It is process-local, so it will
 * not coordinate limits across multiple server instances/processes; if
 * this API is ever run behind a load balancer with multiple instances,
 * replace this with a shared store (e.g. Redis-backed) rate limiter.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  /** Optional: skip rate limiting for requests where this returns true. */
  skip?: (req: Parameters<RequestHandler>[0]) => boolean;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  // Periodically clear out stale buckets so the map doesn't grow forever.
  const sweeper = setInterval(
    () => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    },
    Math.max(options.windowMs, 30_000),
  );
  sweeper.unref?.();

  return (req, res, next) => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > options.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests, please try again later" });
      return;
    }

    next();
  };
}
