import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  registerAuthenticatedSubjectBoundary,
  getAuthenticatedSubject,
} from "../src/auth/authenticated-subject.js";
import {
  OWNER_SUBJECT_ID,
  createOwnerAccessSubjectResolver,
  resolveCanonicalOwnerSubjectResolver,
} from "../src/auth/owner-access.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

const TOKEN = "owner-access-" + "x".repeat(40);

async function createProbeApp(token = TOKEN) {
  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: createOwnerAccessSubjectResolver(token),
  });
  app.get("/api/v1/owner-probe", async (request) => getAuthenticatedSubject(request));
  return app;
}

test("Owner access configuration is durable-only, bounded, and never uses the credential as subject identity", async () => {
  const durable = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "durable",
    LATTICE_AUTHENTICATION_MODE: "required",
    DATABASE_URL: "postgresql://example.invalid/lattice",
  });
  const resolver = resolveCanonicalOwnerSubjectResolver(durable, {
    LATTICE_OWNER_ACCESS_TOKEN: TOKEN,
  });
  assert.equal(typeof resolver, "function");

  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, { resolveSubject: resolver! });
  app.get("/api/v1/subject", async (request) => getAuthenticatedSubject(request));
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/subject",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { subjectId: OWNER_SUBJECT_ID });
    assert.notEqual(response.json().subjectId, TOKEN);
  } finally {
    await app.close();
  }

  assert.throws(
    () => resolveCanonicalOwnerSubjectResolver(durable, { LATTICE_OWNER_ACCESS_TOKEN: " " }),
    /between 32 and 512 visible non-whitespace ASCII characters/,
  );
  assert.throws(
    () => resolveCanonicalOwnerSubjectResolver(durable, { LATTICE_OWNER_ACCESS_TOKEN: "short" }),
    /between 32 and 512 visible non-whitespace ASCII characters/,
  );
  assert.throws(
    () => resolveCanonicalOwnerSubjectResolver(durable, { LATTICE_OWNER_ACCESS_TOKEN: ` ${TOKEN}` }),
    /between 32 and 512 visible non-whitespace ASCII characters/,
  );
  assert.equal(resolveCanonicalOwnerSubjectResolver(durable, {}), undefined);

  const development = resolveRuntimeConfig({ LATTICE_AUTHENTICATION_MODE: "required" });
  assert.throws(
    () => resolveCanonicalOwnerSubjectResolver(development, { LATTICE_OWNER_ACCESS_TOKEN: TOKEN }),
    /supported only with durable required authentication/,
  );
});

test("Owner bearer authentication fails closed for missing, malformed, and incorrect credentials", async () => {
  const app = await createProbeApp();
  try {
    for (const headers of [
      undefined,
      { authorization: TOKEN },
      { authorization: `Basic ${TOKEN}` },
      { authorization: "Bearer" },
      { authorization: "Bearer wrong-token-that-is-still-long-enough-000000" },
      { authorization: `Bearer ${TOKEN} extra` },
    ]) {
      const response = await app.inject({ method: "GET", url: "/api/v1/owner-probe", ...(headers ? { headers } : {}) });
      assert.equal(response.statusCode, 401, response.body);
      assert.deepEqual(response.json(), { error: "AUTHENTICATION_REQUIRED" });
      assert.doesNotMatch(response.body, new RegExp(TOKEN, "u"));
    }

    const authorized = await app.inject({
      method: "GET",
      url: "/api/v1/owner-probe",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(authorized.statusCode, 200, authorized.body);
    assert.deepEqual(authorized.json(), { subjectId: OWNER_SUBJECT_ID });
  } finally {
    await app.close();
  }
});

test("durable mode still rejects development fixture authentication", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "durable",
      DATABASE_URL: "postgresql://example.invalid/lattice",
      LATTICE_AUTHENTICATION_MODE: "development-fixture",
    }),
    /cannot be enabled in durable deployment mode/,
  );
});

test("canonical Solandra uses a session-scoped Owner access gate and bearer wrapper without embedding credentials", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /Owner access/u);
  assert.match(html, /Enter your private access key to use Solandra/u);
  assert.match(html, /sessionStorage\.getItem\(STORAGE_KEY\)/u);
  assert.match(html, /sessionStorage\.setItem\(STORAGE_KEY, value\)/u);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*owner-access/iu);
  assert.match(html, /headers\.set\("authorization", "Bearer " \+ token\)/u);
  assert.match(html, /nativeFetch\("\/api\/v1\/capabilities\/model-assistance", \{/u);
  assert.match(html, /authorization: "Bearer " \+ candidate/u);
  assert.match(html, /window\.ownerFetch\("\/api\/v1\/conversations"/u);
  assert.match(html, /window\.ownerFetch\("\/api\/v1\/runs\//u);
  assert.match(html, /const initializeAccess = async \(\) =>/u);
  assert.match(html, /if \(response\.ok\) \{\s*hideGate\(\);\s*return;/u);
  assert.match(html, /if \(response\.status === 401\) \{\s*showGate\(\);/u);
  assert.doesNotMatch(html, /LATTICE_OWNER_ACCESS_TOKEN/u);
  assert.doesNotMatch(html, new RegExp(TOKEN, "u"));
  assert.doesNotMatch(html, /[?&](?:token|access[_-]?key)=/iu);
});
