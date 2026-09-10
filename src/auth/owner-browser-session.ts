import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthenticatedSubject, AuthenticatedSubjectResolver } from "./authenticated-subject.js";
import { OWNER_SUBJECT_ID } from "./owner-access.js";

const GRANT_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 60 * 60 * 1_000;
const MAX_ACTIVE_AUTHORIZATIONS = 32;
const SESSION_COOKIE_NAME = "__Host-lattice_owner_session";
const OWNER_ACCESS_STORAGE_KEY = "lattice.solandra.owner-access.v1";
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

interface PendingGrant {
  readonly authorizationId: string;
  readonly expiresAtMs: number;
}

interface ActiveSession {
  readonly authorizationId: string;
  readonly expiresAtMs: number;
}

export interface OwnerBrowserSessionGrant {
  readonly authorizationId: string;
  readonly grant: string;
  readonly expiresAt: string;
}

export interface OwnerBrowserSessionExchange {
  readonly authorizationId: string;
  readonly sessionToken: string;
  readonly expiresAt: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return OPAQUE_TOKEN_PATTERN.test(value) ? value : undefined;
  }
  return undefined;
}

function ownerSessionCookie(sessionToken: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE_NAME}=${sessionToken}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function clearedOwnerSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

/**
 * Ephemeral delegation for the single-owner hosted Product. Grants are one-use,
 * sessions are revocable, and neither token is an identity or authorization.
 * Process restart intentionally invalidates all delegated access.
 */
export class OwnerBrowserSessionBroker {
  private readonly grants = new Map<string, PendingGrant>();
  private readonly sessions = new Map<string, ActiveSession>();

  issueGrant(nowMs = Date.now()): OwnerBrowserSessionGrant {
    this.prune(nowMs);
    const authorizationIds = new Set([
      ...[...this.grants.values()].map((grant) => grant.authorizationId),
      ...[...this.sessions.values()].map((session) => session.authorizationId),
    ]);
    if (authorizationIds.size >= MAX_ACTIVE_AUTHORIZATIONS) {
      throw new Error("Too many active Owner browser authorizations.");
    }

    const authorizationId = randomUUID();
    const grant = opaqueToken();
    const expiresAtMs = nowMs + GRANT_TTL_MS;
    this.grants.set(digest(grant), { authorizationId, expiresAtMs });
    return Object.freeze({
      authorizationId,
      grant,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  }

  exchangeGrant(grant: string, nowMs = Date.now()): OwnerBrowserSessionExchange | undefined {
    if (!OPAQUE_TOKEN_PATTERN.test(grant)) return undefined;
    this.prune(nowMs);
    const grantDigest = digest(grant);
    const pending = this.grants.get(grantDigest);
    if (pending === undefined) return undefined;
    this.grants.delete(grantDigest);
    if (pending.expiresAtMs <= nowMs) return undefined;

    const sessionToken = opaqueToken();
    const expiresAtMs = nowMs + SESSION_TTL_MS;
    this.sessions.set(digest(sessionToken), {
      authorizationId: pending.authorizationId,
      expiresAtMs,
    });
    return Object.freeze({
      authorizationId: pending.authorizationId,
      sessionToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  }

  resolveSubject(request: FastifyRequest, nowMs = Date.now()): AuthenticatedSubject | undefined {
    this.prune(nowMs);
    const token = cookieValue(request, SESSION_COOKIE_NAME);
    if (token === undefined) return undefined;
    const session = this.sessions.get(digest(token));
    if (session === undefined || session.expiresAtMs <= nowMs) return undefined;
    return Object.freeze({ subjectId: OWNER_SUBJECT_ID });
  }

  revokeAuthorization(authorizationId: string): boolean {
    let removed = false;
    for (const [key, grant] of this.grants) {
      if (grant.authorizationId !== authorizationId) continue;
      this.grants.delete(key);
      removed = true;
    }
    for (const [key, session] of this.sessions) {
      if (session.authorizationId !== authorizationId) continue;
      this.sessions.delete(key);
      removed = true;
    }
    return removed;
  }

  revokeRequestSession(request: FastifyRequest): boolean {
    const token = cookieValue(request, SESSION_COOKIE_NAME);
    return token === undefined ? false : this.sessions.delete(digest(token));
  }

  private prune(nowMs: number): void {
    for (const [key, grant] of this.grants) {
      if (grant.expiresAtMs <= nowMs) this.grants.delete(key);
    }
    for (const [key, session] of this.sessions) {
      if (session.expiresAtMs <= nowMs) this.sessions.delete(key);
    }
  }
}

export function createOwnerBrowserSessionSubjectResolver(
  ownerResolver: AuthenticatedSubjectResolver,
  broker: OwnerBrowserSessionBroker,
): AuthenticatedSubjectResolver {
  return async (request) => (await ownerResolver(request)) ?? broker.resolveSubject(request);
}

async function hasDirectOwnerCredential(
  request: FastifyRequest,
  ownerResolver: AuthenticatedSubjectResolver,
): Promise<boolean> {
  try {
    return (await ownerResolver(request))?.subjectId === OWNER_SUBJECT_ID;
  } catch {
    return false;
  }
}

function authorizationPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>Authorize browser access</title>
  <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#1d1d1a}button,input{font:inherit}button{padding:10px 14px}input{width:100%;box-sizing:border-box;padding:10px;margin:12px 0}.muted{color:#666}</style>
</head>
<body>
  <h1>Authorize another browser</h1>
  <p>Create a single-use link that establishes temporary Owner authentication without exposing your private access key.</p>
  <button id="create" type="button">Create one-time link</button>
  <input id="link" readonly aria-label="One-time browser authorization link" hidden />
  <button id="copy" type="button" hidden>Copy link</button>
  <button id="revoke" type="button" hidden>Revoke</button>
  <p id="status" class="muted" aria-live="polite"></p>
  <script>
    (() => {
      const STORAGE_KEY = ${JSON.stringify(OWNER_ACCESS_STORAGE_KEY)};
      const create = document.getElementById("create");
      const link = document.getElementById("link");
      const copy = document.getElementById("copy");
      const revoke = document.getElementById("revoke");
      const status = document.getElementById("status");
      let authorizationId = "";
      const ownerToken = () => { try { return sessionStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; } };
      const ownerFetch = (url, options = {}) => {
        const token = ownerToken();
        const headers = new Headers(options.headers || {});
        if (token) headers.set("authorization", "Bearer " + token);
        return fetch(url, { ...options, headers });
      };
      create.addEventListener("click", async () => {
        status.textContent = "";
        if (!ownerToken()) { status.textContent = "Authenticate in Solandra in this browser first."; return; }
        const response = await ownerFetch("/api/v1/auth/browser-session-grants", { method: "POST" });
        if (!response.ok) { status.textContent = response.status === 401 ? "Owner authentication is required." : "Could not create browser access."; return; }
        const body = await response.json();
        authorizationId = body.authorizationId;
        link.value = location.origin + "/auth/session/bootstrap#grant=" + encodeURIComponent(body.grant);
        link.hidden = false; copy.hidden = false; revoke.hidden = false;
        status.textContent = "This link can be used once and expires in five minutes. The resulting session expires in one hour.";
      });
      copy.addEventListener("click", async () => { await navigator.clipboard.writeText(link.value); status.textContent = "Link copied."; });
      revoke.addEventListener("click", async () => {
        if (!authorizationId) return;
        const response = await ownerFetch("/api/v1/auth/browser-sessions/" + encodeURIComponent(authorizationId), { method: "DELETE" });
        if (!response.ok) { status.textContent = "Could not revoke browser access."; return; }
        authorizationId = ""; link.value = ""; link.hidden = true; copy.hidden = true; revoke.hidden = true;
        status.textContent = "Browser access revoked.";
      });
    })();
  </script>
</body>
</html>`;
}

function bootstrapPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>Establishing Solandra access</title>
</head>
<body>
  <p id="status">Establishing secure browser access…</p>
  <script>
    (() => {
      const status = document.getElementById("status");
      const params = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
      const grant = params.get("grant") || "";
      history.replaceState(null, "", location.pathname);
      if (!grant) { status.textContent = "This browser authorization link is missing or invalid."; return; }
      void fetch("/auth/session/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant }),
      }).then((response) => {
        if (!response.ok) throw new Error("not accepted");
        location.replace("/");
      }).catch(() => { status.textContent = "This browser authorization link is invalid, expired, or already used."; });
    })();
  </script>
</body>
</html>`;
}

export function registerOwnerBrowserSessionRoutes(
  app: FastifyInstance,
  broker: OwnerBrowserSessionBroker,
  directOwnerResolver: AuthenticatedSubjectResolver,
): void {
  app.get("/auth/session/authorize", async (_request, reply) => reply
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer")
    .type("text/html; charset=utf-8")
    .send(authorizationPage()));

  app.get("/auth/session/bootstrap", async (_request, reply) => reply
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer")
    .type("text/html; charset=utf-8")
    .send(bootstrapPage()));

  app.post("/api/v1/auth/browser-session-grants", async (request, reply) => {
    if (!(await hasDirectOwnerCredential(request, directOwnerResolver))) {
      return reply.status(403).send({ error: "OWNER_AUTHENTICATION_REQUIRED" });
    }
    try {
      const issued = broker.issueGrant();
      return reply.header("cache-control", "no-store").send(issued);
    } catch {
      return reply.status(429).send({ error: "OWNER_BROWSER_SESSION_LIMIT" });
    }
  });

  app.delete<{ Params: { authorizationId: string } }>(
    "/api/v1/auth/browser-sessions/:authorizationId",
    async (request, reply) => {
      if (!(await hasDirectOwnerCredential(request, directOwnerResolver))) {
        return reply.status(403).send({ error: "OWNER_AUTHENTICATION_REQUIRED" });
      }
      broker.revokeAuthorization(request.params.authorizationId);
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { grant?: unknown } }>("/auth/session/exchange", async (request, reply) => {
    const grant = typeof request.body?.grant === "string" ? request.body.grant : "";
    const session = broker.exchangeGrant(grant);
    if (session === undefined) {
      return reply.status(401).header("cache-control", "no-store").send({ error: "AUTHENTICATION_REQUIRED" });
    }
    return reply
      .status(204)
      .header("cache-control", "no-store")
      .header("set-cookie", ownerSessionCookie(session.sessionToken, SESSION_TTL_MS / 1_000))
      .send();
  });

  app.delete("/auth/session", async (request, reply) => {
    broker.revokeRequestSession(request);
    return reply
      .status(204)
      .header("cache-control", "no-store")
      .header("set-cookie", clearedOwnerSessionCookie())
      .send();
  });
}
