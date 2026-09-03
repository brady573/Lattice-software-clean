import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  getAuthenticatedSubject,
  registerAuthenticatedSubjectBoundary,
} from "../src/auth/authenticated-subject.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

test("required authentication fails closed when no subject resolver establishes identity", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({
    LATTICE_AUTHENTICATION_MODE: "required",
  }));
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "AUTHENTICATION_REQUIRED" });
  } finally {
    await app.close();
  }
});

test("injected provider-neutral resolver establishes only AuthenticatedSubject.subjectId", async () => {
  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: async () => ({ subjectId: " subject-a " }),
  });
  app.get("/api/v1/subject-probe", async (request) => getAuthenticatedSubject(request));

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/subject-probe" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { subjectId: "subject-a" });
    assert.deepEqual(Object.keys(response.json()).sort(), ["subjectId"]);
  } finally {
    await app.close();
  }
});

test("required authentication accepts a valid injected subject on authoritative runtime APIs", async () => {
  const app = await createRuntimeApp(
    resolveRuntimeConfig({ LATTICE_AUTHENTICATION_MODE: "required" }),
    { authenticatedSubjectResolver: () => ({ subjectId: "subject-a" }) },
  );
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(response.statusCode, 201);
    assert.equal(typeof response.json().conversation?.id, "string");
  } finally {
    await app.close();
  }
});

test("blank and throwing subject resolvers fail closed", async () => {
  for (const authenticatedSubjectResolver of [
    () => ({ subjectId: "   " }),
    () => { throw new Error("provider failure"); },
  ]) {
    const app = await createRuntimeApp(
      resolveRuntimeConfig({ LATTICE_AUTHENTICATION_MODE: "required" }),
      { authenticatedSubjectResolver },
    );
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: "AUTHENTICATION_REQUIRED" });
    } finally {
      await app.close();
    }
  }
});

test("development fixture authentication remains explicit and usable for local execution", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "local-fixture-user",
  }));
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(response.statusCode, 201);
  } finally {
    await app.close();
  }
});

test("development-only prototype model route is absent from canonical RuntimeApp", async () => {
  const app = await createRuntimeApp(resolveRuntimeConfig({
    LATTICE_AUTHENTICATION_MODE: "required",
  }));
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/probe/messages",
      payload: {
        turnId: "turn-1",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    assert.equal(app.hasRoute({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/:conversationId/messages",
    }), false);
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
