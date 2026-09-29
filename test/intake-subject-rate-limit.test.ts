import assert from "node:assert/strict";
import test from "node:test";
import { createSubjectRateLimiter } from "../src/ratelimit/subject-limiter.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const baseEnv = {
  PORT: "3000",
  HOST: "127.0.0.1",
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_AUTO_MIGRATE: "false",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
};

function resolveTestSubject(request: { headers: Record<string, unknown> }) {
  const value = request.headers["x-test-subject"];
  return typeof value === "string" && value.trim() ? { subjectId: value } : undefined;
}

function subjectHeaders(subjectId: string): Record<string, string> {
  return { "x-test-subject": subjectId };
}

async function createConversation(app: {
  inject: (options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) => Promise<{ statusCode: number; body: string; json(): unknown }>;
}, headers?: Record<string, string>): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/conversations",
    ...(headers === undefined ? {} : { headers }),
  });
  assert.equal(created.statusCode, 201, created.body);
  return (created.json() as { conversation: { id: string } }).conversation.id;
}

test("flooding the turns route returns 429 with a JSON body and Retry-After", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({ ...baseEnv }), {
    memoryDispatchDelayMs: 0,
    subjectRateLimiter: createSubjectRateLimiter({ maxRequests: 3, windowMs: 60_000 }),
  });

  try {
    const conversationId = await createConversation(app);
    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: `rate-turn-${index}`, message: `Rate limit probe message ${index}.` },
      });
      assert.equal(response.statusCode, 202, response.body);
    }

    const flooded = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "rate-turn-flood", message: "This request exceeds the subject budget." },
    });
    assert.equal(flooded.statusCode, 429, flooded.body);
    assert.deepEqual(flooded.json(), { error: "INTAKE_RATE_LIMITED" });
    const retryAfter = flooded.headers["retry-after"];
    assert.ok(typeof retryAfter === "string" && /^\d+$/.test(retryAfter), `Retry-After must be seconds, got: ${retryAfter}`);
    assert.ok(Number(retryAfter) >= 1, "Retry-After must name a positive delay");

    // The confirm route shares the subject budget and rejects before any
    // proposal lookup, so even an unknown proposal reports the limit first.
    const confirmFlooded = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/does-not-exist/confirm`,
      payload: { turnId: "rate-confirm-flood", message: "Yes, that is correct." },
    });
    assert.equal(confirmFlooded.statusCode, 429, confirmFlooded.body);
    assert.deepEqual(confirmFlooded.json(), { error: "INTAKE_RATE_LIMITED" });
    assert.ok(typeof confirmFlooded.headers["retry-after"] === "string");
  } finally {
    await app.close();
  }
});

test("intake rate budget is isolated per authenticated subject", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({ ...baseEnv }), {
    memoryDispatchDelayMs: 0,
    authenticatedSubjectResolver: resolveTestSubject,
    subjectRateLimiter: createSubjectRateLimiter({ maxRequests: 2, windowMs: 60_000 }),
  });

  try {
    const conversationA = await createConversation(app, subjectHeaders("subject-a"));
    const conversationB = await createConversation(app, subjectHeaders("subject-b"));

    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationA}/turns`,
        headers: subjectHeaders("subject-a"),
        payload: { turnId: `isolation-a-${index}`, message: `Subject A probe ${index}.` },
      });
      assert.equal(response.statusCode, 202, response.body);
    }
    const floodedA = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationA}/turns`,
      headers: subjectHeaders("subject-a"),
      payload: { turnId: "isolation-a-flood", message: "Subject A over budget." },
    });
    assert.equal(floodedA.statusCode, 429, floodedA.body);

    const otherSubject = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationB}/turns`,
      headers: subjectHeaders("subject-b"),
      payload: { turnId: "isolation-b-0", message: "Subject B stays within budget." },
    });
    assert.equal(otherSubject.statusCode, 202, otherSubject.body);
  } finally {
    await app.close();
  }
});

test("requests under the limit pass through to normal intake behavior", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({ ...baseEnv }), {
    memoryDispatchDelayMs: 0,
    subjectRateLimiter: createSubjectRateLimiter({ maxRequests: 3, windowMs: 60_000 }),
  });

  try {
    const conversationId = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "rate-pass-through", message: "A single turn within budget." },
    });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(response.headers["retry-after"], undefined);
  } finally {
    await app.close();
  }
});

test("unauthenticated intake keeps the existing 401 behavior", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({ ...baseEnv }), {
    memoryDispatchDelayMs: 0,
    authenticatedSubjectResolver: () => undefined,
    subjectRateLimiter: createSubjectRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/anything/turns",
      payload: { turnId: "rate-unauthenticated", message: "No subject resolves." },
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.deepEqual(response.json(), { error: "AUTHENTICATION_REQUIRED" });
    assert.equal(response.headers["retry-after"], undefined);
  } finally {
    await app.close();
  }
});
