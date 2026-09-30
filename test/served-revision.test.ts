import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registerAuthenticatedSubjectBoundary } from "../src/auth/authenticated-subject.js";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";

const REVISION_ENV_KEYS = ["LATTICE_BUILD_SHA", "LATTICE_BUILD_TIME", "RENDER_GIT_COMMIT"] as const;

function snapshotRevisionEnv(): Record<(typeof REVISION_ENV_KEYS)[number], string | undefined> {
  return {
    LATTICE_BUILD_SHA: process.env.LATTICE_BUILD_SHA,
    LATTICE_BUILD_TIME: process.env.LATTICE_BUILD_TIME,
    RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
  };
}

function restoreRevisionEnv(snapshot: Record<(typeof REVISION_ENV_KEYS)[number], string | undefined>): void {
  for (const key of REVISION_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function currentHeadSha(): string {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: repoRoot }).trim();
}

test("revision surface reports the exact built commit SHA", async () => {
  const snapshot = snapshotRevisionEnv();
  const head = currentHeadSha();
  process.env.LATTICE_BUILD_SHA = head;
  delete process.env.LATTICE_BUILD_TIME;
  try {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/version" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.json().commit, head);
    } finally {
      await app.close();
    }
  } finally {
    restoreRevisionEnv(snapshot);
  }
});

test("explicit build injection takes precedence over platform-provided commit", async () => {
  const snapshot = snapshotRevisionEnv();
  process.env.LATTICE_BUILD_SHA = "injected-build-sha";
  process.env.RENDER_GIT_COMMIT = "platform-provided-sha";
  delete process.env.LATTICE_BUILD_TIME;
  try {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/version" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().commit, "injected-build-sha");
    } finally {
      await app.close();
    }
  } finally {
    restoreRevisionEnv(snapshot);
  }
});

test("revision surface stays outside the authenticated-subject boundary", async () => {
  const snapshot = snapshotRevisionEnv();
  process.env.LATTICE_BUILD_SHA = "boundary-probe-sha";
  delete process.env.LATTICE_BUILD_TIME;
  try {
    const app = buildApp();
    try {
      registerAuthenticatedSubjectBoundary(app, { resolveSubject: () => undefined });
      const version = await app.inject({ method: "GET", url: "/api/version" });
      assert.equal(version.statusCode, 200);
      assert.equal(version.json().commit, "boundary-probe-sha");
      const guarded = await app.inject({ method: "GET", url: "/api/v1/runs/missing" });
      assert.equal(guarded.statusCode, 401);
    } finally {
      await app.close();
    }
  } finally {
    restoreRevisionEnv(snapshot);
  }
});

test("revision surface falls back to the platform-provided commit when no explicit SHA was injected", async () => {
  const snapshot = snapshotRevisionEnv();
  delete process.env.LATTICE_BUILD_SHA;
  delete process.env.LATTICE_BUILD_TIME;
  process.env.RENDER_GIT_COMMIT = "render-sha";
  try {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/version" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().commit, "render-sha");
    } finally {
      await app.close();
    }
  } finally {
    restoreRevisionEnv(snapshot);
  }
});

test("revision surface serves the construction-time snapshot, immune to later env mutation", async () => {
  const snapshot = snapshotRevisionEnv();
  process.env.LATTICE_BUILD_SHA = "construction-time-sha";
  delete process.env.LATTICE_BUILD_TIME;
  delete process.env.RENDER_GIT_COMMIT;
  try {
    const app = buildApp();
    try {
      process.env.LATTICE_BUILD_SHA = "mutated-after-construction";
      const response = await app.inject({ method: "GET", url: "/api/version" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().commit, "construction-time-sha");
    } finally {
      await app.close();
    }
  } finally {
    restoreRevisionEnv(snapshot);
  }
});

test("revision surface honestly reports unknown when nothing was injected", async () => {
  const snapshot = snapshotRevisionEnv();
  delete process.env.LATTICE_BUILD_SHA;
  delete process.env.LATTICE_BUILD_TIME;
  delete process.env.RENDER_GIT_COMMIT;
  try {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/version" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().commit, "unknown");
    } finally {
      await app.close();
    }
  } finally {
    restoreRevisionEnv(snapshot);
  }
});
