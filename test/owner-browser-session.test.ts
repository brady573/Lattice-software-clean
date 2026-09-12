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
  const directOwnerResolver = createOwnerAccessSubjectResolver(OWNER_TOKEN);
  const app = Fastify({ logger: false });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: createOwnerBrowserSessionSubjectResolver(directOwnerResolver, broker),
  });
  registerOwnerBrowserSessionRoutes(app, broker, directOwnerResolver);
  app.get("/api/v1/session-probe", async (request) => getAuthenticatedSubject(request));
  return { app };
}

function headerString(value: HeaderValue): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (typeof resolved !== "string") throw new Error("Expected string response header.");
  return resolved;
}

function sessionCookie(response: { headers: { [key: string]: HeaderValue } }): string {
  return headerString(response.headers["set-cookie"]).split(";", 1)[0]!;
}

test("one-time browser grant establishes an attenuated revocable Owner session", async () => {
  const { app } = await createSessionProbeApp();
  try {
    const unauthorized = await app.inject({ method: "GET", url: "/api/v1/session-probe" });
    assert.equal(unauthorized.statusCode, 401);

    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/auth/browser-session-grants",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    assert.equal(issued.statusCode, 200, issued.body);
    const grant = issued.json<{ authorizationId: string; grant: string; expiresAt: string }>();
    assert.match(grant.grant, /^[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(grant.grant, OWNER_TOKEN);
    assert.ok(Date.parse(grant.expiresAt) > Date.now());

    const exchanged = await app.inject({ method: "POST", url: "/auth/session/exchange", payload: { grant: grant.grant } });
    assert.equal(exchanged.statusCode, 204, exchanged.body);
    const setCookie = headerString(exchanged.headers["set-cookie"]);
    assert.match(setCookie, /__Host-lattice_owner_session=[A-Za-z0-9_-]{43}/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /Secure/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.match(setCookie, /Max-Age=3600/u);
    const cookie = sessionCookie(exchanged);

    const replay = await app.inject({ method: "POST", url: "/auth/session/exchange", payload: { grant: grant.grant } });
    assert.equal(replay.statusCode, 401);

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const authorized = await app.inject({ method: "GET", url: "/api/v1/session-probe", headers: { cookie } });
      assert.equal(authorized.statusCode, 200, authorized.body);
      assert.deepEqual(authorized.json(), { subjectId: OWNER_SUBJECT_ID });
    }

    const delegatedRemint = await app.inject({
      method: "POST",
      url: "/api/v1/auth/browser-session-grants",
      headers: { cookie },
    });
    assert.equal(delegatedRemint.statusCode, 403);
    assert.deepEqual(delegatedRemint.json(), { error: "OWNER_AUTHENTICATION_REQUIRED" });

    const separateUnauthorizedContext = await app.inject({ method: "GET", url: "/api/v1/session-probe" });
    assert.equal(separateUnauthorizedContext.statusCode, 401);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/browser-sessions/${grant.authorizationId}`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    assert.equal(revoked.statusCode, 204);
    const afterRevocation = await app.inject({ method: "GET", url: "/api/v1/session-probe", headers: { cookie } });
    assert.equal(afterRevocation.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("authorization and bootstrap utility pages keep secrets out of request URLs", async () => {
  const { app } = await createSessionProbeApp();
  try {
    const authorize = await app.inject({ method: "GET", url: "/auth/session/authorize" });
    assert.equal(authorize.statusCode, 200);
    assert.equal(authorize.headers["cache-control"], "no-store");
    assert.equal(authorize.headers["referrer-policy"], "no-referrer");
    assert.match(authorize.body, /sessionStorage\.getItem\(STORAGE_KEY\)/u);
    assert.match(authorize.body, /\/auth\/session\/bootstrap#grant=/u);
    assert.doesNotMatch(authorize.body, /localStorage/u);
    assert.doesNotMatch(authorize.body, new RegExp(OWNER_TOKEN, "u"));

    const bootstrap = await app.inject({ method: "GET", url: "/auth/session/bootstrap" });
    assert.equal(bootstrap.statusCode, 200);
    assert.match(bootstrap.body, /location\.hash/u);
    assert.match(bootstrap.body, /history\.replaceState/u);
    assert.match(bootstrap.body, /\/auth\/session\/exchange/u);
    assert.doesNotMatch(bootstrap.body, /[?&](?:grant|token)=/iu);
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
    const exchanged = await first.app.inject({ method: "POST", url: "/auth/session/exchange", payload: { grant } });
    cookie = sessionCookie(exchanged);
  } finally {
    await first.app.close();
  }

  const second = await createSessionProbeApp();
  try {
    const response = await second.app.inject({ method: "GET", url: "/api/v1/session-probe", headers: { cookie } });
    assert.equal(response.statusCode, 401);
  } finally {
    await second.app.close();
  }
});
