import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { Pool } from "pg";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";
import { assertDurableProcessSchemaReady } from "../src/runtime-schema-readiness.js";

const databaseUrl = process.env.DATABASE_URL;

async function withMissingMigration(
  pool: Pool,
  name: string,
  probe: () => Promise<void>,
): Promise<void> {
  const deleted = await pool.query<{ name: string }>(
    "DELETE FROM schema_migrations WHERE name=$1 RETURNING name",
    [name],
  );
  assert.equal(deleted.rowCount, 1, `expected migration ${name} to be present before probe`);
  try {
    await probe();
  } finally {
    await pool.query(
      "INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
      [name],
    );
  }
}

async function expectStartupFailure(
  entrypoint: string,
  env: NodeJS.ProcessEnv,
  expectedError: RegExp,
): Promise<void> {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

  const [code, signal] = await once(child, "exit");
  assert.equal(code, 1, `${entrypoint} unexpectedly exited with stderr: ${stderr}`);
  assert.equal(signal, null);
  assert.match(stderr, expectedError);
  assert.doesNotMatch(stdout, /LATTICE_(?:RUN|RESEARCH)_WORKER_READY/);
}

test(
  "separated durable process roles fail closed on incomplete migration lineage",
  { skip: !databaseUrl, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await assertDurableProcessSchemaReady(databaseUrl, "api");
      await assertDurableProcessSchemaReady(databaseUrl, "run-worker");
      await assertDurableProcessSchemaReady(databaseUrl, "research-worker");

      await expectStartupFailure(
        "dist/src/index.js",
        {
          DATABASE_URL: databaseUrl,
          LATTICE_DEPLOYMENT_MODE: "durable",
          LATTICE_AUTO_MIGRATE: "true",
          PORT: "39999",
        },
        /Durable API startup forbids LATTICE_AUTO_MIGRATE=true/,
      );

      await withMissingMigration(pool, "010_truth_evidence_graph.sql", async () => {
        await assert.rejects(
          assertDurableProcessSchemaReady(databaseUrl, "api"),
          /010_truth_evidence_graph\.sql/,
        );
        await assert.rejects(
          assertDurableProcessSchemaReady(databaseUrl, "run-worker"),
          /010_truth_evidence_graph\.sql/,
        );
        await assert.rejects(
          assertDurableProcessSchemaReady(databaseUrl, "research-worker"),
          /010_truth_evidence_graph\.sql/,
        );

        await expectStartupFailure(
          "dist/src/index.js",
          {
            DATABASE_URL: databaseUrl,
            LATTICE_DEPLOYMENT_MODE: "durable",
            LATTICE_AUTO_MIGRATE: "false",
            PORT: "39999",
          },
          /010_truth_evidence_graph\.sql/,
        );
        await expectStartupFailure(
          "dist/src/run-worker-main.js",
          { DATABASE_URL: databaseUrl },
          /010_truth_evidence_graph\.sql/,
        );
        await expectStartupFailure(
          "dist/src/research-worker-main.js",
          { DATABASE_URL: databaseUrl },
          /010_truth_evidence_graph\.sql/,
        );
      });

      await withMissingMigration(pool, "019_api_idempotency.sql", async () => {
        for (const role of ["api", "run-worker", "research-worker"] as const) {
          await assert.rejects(
            assertDurableProcessSchemaReady(databaseUrl, role),
            /019_api_idempotency\.sql/,
          );
        }
      });

      await assertDurableProcessSchemaReady(databaseUrl, "api");
      await assertDurableProcessSchemaReady(databaseUrl, "run-worker");
      await assertDurableProcessSchemaReady(databaseUrl, "research-worker");
    } finally {
      await pool.end();
    }
  },
);
