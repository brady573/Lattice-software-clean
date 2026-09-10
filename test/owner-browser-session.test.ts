import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  getAuthenticatedSubject,
  registerAuthenticatedSubjectBoundary,
} from "../src/auth/authenticated-subject.js";
import { createOwnerAccessSubjectResolver, OWNER_SUBJECT_ID } from "../src/auth/owner-access.js";
import {
  createOwnerBrowserSessionSubjectResolver,
  OwnerBrowserSessionBroker,
  registerOwnerBrowserSessionRoutes,
} from "../src/auth/owner-browser-session.js";

const OWNER_TOKEN = `owner-access-${"x".repeat(40)}`;

type HeaderValue = string | string[] | number | undefined;

async function createSessionProbeApp() {
  const broker = new OwnerBrowserSessionBroker();
  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: createOwnerBrowserSessionSubjectResolver(
      createOwnerAccessSubjectResolver(OWNER_TOKEN),
      broker,
    ),
  });
  registerOwnerBrowserSessionRoutes(app, broker);
  app.get("/api/v1/session-probe", async (request) => getAuthenticatedSubject(request));
  return { app, broker };
}

function headerString(value: HeaderValue): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (typeof resolved !== "string") throw new Error("Expected string response header.");
  return resolved;
}

function sessionCookie(response: { headers: { [key: string]: HeaderValue } }): string {
  return headerString(response.headers["set-cookie"]).split(";", 1)[0]!;
}

test("one-time browser grant establishes a revocable Owner session without exposing the Owner credential", async () => {
  const { app } = await createSessionProbeApp();
  try {
    const unauthorized = await app.inject({ method: "GET", url: "/api/v1/session-probe" });
    assert.equal(unauthorized.statusCode, 401);
    assert.deepEqual(unauthorized.json(), { error: "AUTHENTICATION_REQUIRED" });

    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/auth/browser-session-grants",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    assert.equal(issued.statusCode, 200, issued.body);
    const grant = issued.json<{
      authorizationId: string;
      grant: string;
      expiresAt: string;
    }>();
    assert.match(grant.authorizationId, /^[0-9a-f-]{36}$/u);
    assert.match(grant.grant, /^[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(grant.grant, OWNER_TOKEN);
    assert.ok(Date.parse(grant.expiresAt) > Date.now());
    assert.doesNotMatch(issued.body, new RegExp(OWNER_TOKEN, "u"));
    assert.equal(issued.headers["cache-control"], "no-store");

    const bootstrap = await app.inject({ method: "GET", url: "/auth/session/bootstrap" });
    assert.equal(bootstrap.statusCode, 200);
    assert.match(bootstrap.body, /location\.hash/u);
    assert.match(bootstrap.body, /history\.replaceState/u);
    assert.match(bootstrap.body, /\/auth\/session\/exchange/u);
    assert.doesNotMatch(bootstrap.body, /[?&](?:grant|token)=/iu);
    assert.doesNotMatch(bootstrap.body, new RegExp(OWNER_TOKEN, "u"));

    const exchanged = await app.inject({
      method: "POST",
      url: "/auth/session/exchange",
      payload: { grant: grant.grant },
    });
    assert.equal(exchanged.statusCode, 204, exchanged.body);
    const setCookie = headerString(exchanged.headers["set-cookie"]);
    assert.match(setCookie, /lattice_owner_session=[A-Za-z0-9_-]{43}/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /Secure/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.match(setCookie, /Max-Age=3600/u);
    assert.doesNotMatch(setCookie, new RegExp(OWNER_TOKEN, "u"));
    const cookie = sessionCookie(exchanged);

    const replay = await app.inject({
      method: "POST",
      url: "/auth/session/exchange",
      payload: { grant: grant.grant },
    });
    assert.equal(replay.statusCode, 401);

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const authorized = await app.inject({
        method: "GET",
        url: "/api/v1/session-probe",
        headers: { cookie },
      });
      assert.equal(authorized.statusCode, 200, authorized.body);
      assert.deepEqual(authorized.json(), { subjectId: OWNER_SUBJECT_ID });
    }

    const separateUnauthorizedContext = await app.inject({
      method: "GET",
      url: "/api/v1/session-probe",
    });
    assert.equal(separateUnauthorizedContext.statusCode, 401);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/browser-sessions/${grant.authorizationId}`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    assert.equal(revoked.statusCode, 204, revoked.body);

    const afterRevocation = await app.inject({
      method: "GET",
      url: "/api/v1/session-probe",
      headers: { cookie },
    });
    assert.equal(afterRevocation.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("authorization utility uses the existing session-scoped Owner credential only to mint a delegated link", async () => {
  const { app } = await createSessionProbeApp();
  try {
    const page = await app.inject({ method: "GET", url: "/auth/session/authorize" });
    assert.equal(page.statusCode, 200);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    assert.match(page.body, /lattice\.solandra\.owner-access\.v1/u);
    assert.match(page.body, /sessionStorage\.getItem\(STORAGE_KEY\)/u);
    assert.match(page.body, /\/api\/v1\/auth\/browser-session-grants/u);
    assert.match(page.body, /\/auth\/session\/bootstrap#grant=/u);
    assert.match(page.body, /\/api\/v1\/auth\/browser-sessions\//u);
    assert.doesNotMatch(page.body, /localStorage/u);
    assert.doesNotMatch(page.body, new RegExp(OWNER_TOKEN, "u"));
  } finally {
    await app.close();
  }
});

test("a fresh broker rejects a delegated cookie issued by a previous process", async () => {
  const first = await createSessionProbeApp();
  let cookie: string;
  try {
    const issued = await first.app.inject({
      method: "POST",
      url: "/api/v1/auth/browser-session-grants",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const grant = issued.json<{ grant: string }>().grant;
    const exchanged = await first.app.inject({
      method: "POST",
      url: "/auth/session/exchange",
      payload: { grant },
    });
    cookie = sessionCookie(exchanged);
  } finally {
    await first.app.close();
  }

  const second = await createSessionProbeApp();
  try {
    const response = await second.app.inject({
      method: "GET",
      url: "/api/v1/session-probe",
      headers: { cookie },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await second.app.close();
  }
});
