import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "032_intent_consultation_scope.sql" as const;

export async function migrateConsultationIntentScope(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const existing = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name=$1",
      [migration],
    );
    if ((existing.rowCount ?? 0) > 0) return;
    const sql = await readFile(resolve(process.cwd(), "migrations", migration), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migration]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
