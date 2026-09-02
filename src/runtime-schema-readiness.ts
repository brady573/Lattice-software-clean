import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

export type DurableProcessRole = "api" | "run-worker" | "research-worker";

async function expectedRuntimeMigrations(): Promise<string[]> {
  const entries = await readdir(resolve(process.cwd(), "migrations"), { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (migrations.length === 0) {
    throw new Error("No runtime migration files were found for durable schema readiness verification.");
  }
  return migrations;
}

/**
 * Verify that a separated durable process is starting against the complete
 * migration lineage expected by its exact runtime revision. This function is
 * read-only: durable API and worker processes never acquire migration authority.
 */
export async function assertDurableProcessSchemaReady(
  databaseUrl: string,
  role: DurableProcessRole,
): Promise<void> {
  const required = await expectedRuntimeMigrations();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("SELECT 1");
    const registry = await pool.query<{ schema_migrations: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS schema_migrations",
    );
    if (!registry.rows[0]?.schema_migrations) {
      throw new Error(
        `Durable ${role} schema is not initialized; run the authorized db:migrate command before startup.`,
      );
    }

    const applied = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = ANY($1::text[])",
      [required],
    );
    const present = new Set(applied.rows.map((row) => row.name));
    const missing = required.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Durable ${role} schema is not ready; missing required migrations: ${missing.join(", ")}. Run the authorized db:migrate command before startup.`,
      );
    }
  } finally {
    await pool.end();
  }
}
