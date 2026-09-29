/**
 * Per-authenticated-subject fixed-window rate limiting for expensive intake routes.
 *
 * Single shared limiter module for the consultation intake routes
 * (POST /api/v1/conversations/:conversationId/turns and
 * POST /api/v1/conversations/:conversationId/clarifications/:proposalId/confirm).
 * Both routes can trigger expensive downstream consultation work, so they share
 * one per-subject budget rather than carrying independent allowances.
 *
 * Single-process semantics: counters live in memory. When Lattice runs as more
 * than one process (or restarts), each process enforces its own independent
 * window, so the effective allowance scales with process count and recent
 * history is lost on restart. That is acceptable for flood protection on a
 * single-owner deployment, but this module must not be mistaken for a
 * distributed quota: do not use it where exact cross-process accounting is a
 * trust requirement.
 */

export const DEFAULT_SUBJECT_RATE_LIMIT_MAX_REQUESTS = 30;
export const DEFAULT_SUBJECT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface SubjectRateLimitConfig {
  /** Maximum admitted requests per subject within one fixed window. */
  maxRequests: number;
  /** Fixed window length in milliseconds. */
  windowMs: number;
}

export interface SubjectRateLimitVerdict {
  allowed: boolean;
  /**
   * Milliseconds until the current window ends. Positive when denied; zero
   * when admitted. Route handlers map this to the Retry-After response header.
   */
  retryAfterMs: number;
}

export interface SubjectRateLimiter {
  check(subjectId: string, nowMs?: number): SubjectRateLimitVerdict;
  /** Forget all counters. Intended for tests, not for Product reset paths. */
  clear(): void;
  readonly config: SubjectRateLimitConfig;
}

interface SubjectWindow {
  windowStartMs: number;
  count: number;
}

/** Bound the counter map so a flood of distinct subjects cannot grow it without limit. */
const MAX_TRACKED_SUBJECTS = 5_000;

function resolveConfig(config: Partial<SubjectRateLimitConfig> | undefined): SubjectRateLimitConfig {
  const maxRequests = config?.maxRequests ?? DEFAULT_SUBJECT_RATE_LIMIT_MAX_REQUESTS;
  const windowMs = config?.windowMs ?? DEFAULT_SUBJECT_RATE_LIMIT_WINDOW_MS;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 100_000) {
    throw new Error("Subject rate limit maxRequests must be an integer between 1 and 100000.");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
    throw new Error("Subject rate limit windowMs must be an integer between 1000 and 3600000.");
  }
  return { maxRequests, windowMs };
}

export function createSubjectRateLimiter(
  config?: Partial<SubjectRateLimitConfig>,
): SubjectRateLimiter {
  const resolved = resolveConfig(config);
  const windows = new Map<string, SubjectWindow>();

  function pruneExpired(nowMs: number): void {
    for (const [subjectId, window] of windows) {
      if (nowMs - window.windowStartMs >= resolved.windowMs) {
        windows.delete(subjectId);
      }
    }
  }

  return {
    config: resolved,
    check(subjectId: string, nowMs: number = Date.now()): SubjectRateLimitVerdict {
      const existing = windows.get(subjectId);
      if (existing !== undefined && nowMs - existing.windowStartMs < resolved.windowMs) {
        if (existing.count < resolved.maxRequests) {
          existing.count += 1;
          return { allowed: true, retryAfterMs: 0 };
        }
        return {
          allowed: false,
          retryAfterMs: existing.windowStartMs + resolved.windowMs - nowMs,
        };
      }
      if (existing === undefined && windows.size >= MAX_TRACKED_SUBJECTS) {
        pruneExpired(nowMs);
      }
      windows.set(subjectId, { windowStartMs: nowMs, count: 1 });
      return { allowed: true, retryAfterMs: 0 };
    },
    clear(): void {
      windows.clear();
    },
  };
}
