import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migrationName = "021_v36_research_continuation_rounds.sql";

export async function migrateV36ResearchContinuationRounds(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const existing = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
      [migrationName],
    );
    if (existing.rows[0]?.count === "1") return;
    const sql = await readFile(resolve(process.cwd(), "migrations", migrationName), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migrationName]);
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

export async function assertV36ResearchContinuationRoundsReady(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<{ continuation: string | null; count: string }>(
      `SELECT
         to_regclass('public.v36_research_continuations')::text AS continuation,
         (SELECT count(*)::text FROM schema_migrations WHERE name=$1) AS count`,
      [migrationName],
    );
    const row = result.rows[0];
    if (!row?.continuation || row.count !== "1") {
      throw new Error(`V36 durable continuation schema is not ready; required migration ${migrationName} is missing.`);
    }
  } finally {
    await pool.end();
  }
}
