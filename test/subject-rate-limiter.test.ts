import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubjectRateLimiter,
  DEFAULT_SUBJECT_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_SUBJECT_RATE_LIMIT_WINDOW_MS,
} from "../src/ratelimit/subject-limiter.js";

test("limiter admits up to the budget, then denies with a positive retry delay", () => {
  const limiter = createSubjectRateLimiter({ maxRequests: 3, windowMs: 60_000 });
  const start = 1_000_000;
  assert.deepEqual(limiter.check("subject-a", start), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.check("subject-a", start + 10), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.check("subject-a", start + 20), { allowed: true, retryAfterMs: 0 });
  const denied = limiter.check("subject-a", start + 30);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs > 0, "denial must name a positive retry delay");
  assert.ok(denied.retryAfterMs <= 60_000, "retry delay must not exceed the window");
  assert.equal(denied.retryAfterMs, start + 60_000 - (start + 30));
});

test("window expiry resets the budget for the same subject", () => {
  const limiter = createSubjectRateLimiter({ maxRequests: 1, windowMs: 1_000 });
  assert.equal(limiter.check("subject-a", 5_000).allowed, true);
  assert.equal(limiter.check("subject-a", 5_500).allowed, false);
  assert.equal(limiter.check("subject-a", 5_999).allowed, false);
  const reopened = limiter.check("subject-a", 6_000);
  assert.deepEqual(reopened, { allowed: true, retryAfterMs: 0 });
});

test("budgets are isolated per subject", () => {
  const limiter = createSubjectRateLimiter({ maxRequests: 2, windowMs: 60_000 });
  assert.equal(limiter.check("subject-a", 0).allowed, true);
  assert.equal(limiter.check("subject-a", 1).allowed, true);
  assert.equal(limiter.check("subject-a", 2).allowed, false);
  assert.deepEqual(limiter.check("subject-b", 3), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.check("subject-b", 4), { allowed: true, retryAfterMs: 0 });
  assert.equal(limiter.check("subject-b", 5).allowed, false);
  // Subject A remains denied on its own window while B exhausts its own.
  assert.equal(limiter.check("subject-a", 6).allowed, false);
});

test("denied retry delay counts down toward the owning window end", () => {
  const limiter = createSubjectRateLimiter({ maxRequests: 1, windowMs: 10_000 });
  limiter.check("subject-a", 100_000);
  const first = limiter.check("subject-a", 101_000);
  const second = limiter.check("subject-a", 105_000);
  assert.equal(first.allowed, false);
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterMs < first.retryAfterMs, "retry delay must shrink as the window elapses");
  assert.equal(second.retryAfterMs, 100_000 + 10_000 - 105_000);
});

test("clear forgets every subject window", () => {
  const limiter = createSubjectRateLimiter({ maxRequests: 1, windowMs: 60_000 });
  assert.equal(limiter.check("subject-a", 0).allowed, true);
  assert.equal(limiter.check("subject-a", 1).allowed, false);
  limiter.clear();
  assert.deepEqual(limiter.check("subject-a", 2), { allowed: true, retryAfterMs: 0 });
});

test("safe defaults bound interactive use without deployment configuration", () => {
  assert.equal(DEFAULT_SUBJECT_RATE_LIMIT_MAX_REQUESTS, 30);
  assert.equal(DEFAULT_SUBJECT_RATE_LIMIT_WINDOW_MS, 60_000);
  const limiter = createSubjectRateLimiter();
  assert.deepEqual(limiter.config, { maxRequests: 30, windowMs: 60_000 });
});

test("invalid limiter configuration fails closed at construction", () => {
  assert.throws(() => createSubjectRateLimiter({ maxRequests: 0 }), /maxRequests/);
  assert.throws(() => createSubjectRateLimiter({ maxRequests: 1.5 }), /maxRequests/);
  assert.throws(() => createSubjectRateLimiter({ windowMs: 999 }), /windowMs/);
  assert.throws(() => createSubjectRateLimiter({ windowMs: 3_600_001 }), /windowMs/);
});
