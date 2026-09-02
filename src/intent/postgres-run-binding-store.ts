import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import type { LatticeRun, RunStatus } from "../domain.js";
import type {
  IntentBoundRunStore,
  RunIntentBinding,
  RunIntentBindingInput,
  RunSupersessionInput,
  RunSupersessionRecord,
  RunSupersessionResult,
} from "./run-binding.js";
import {
  assertCanonicalPendingRun,
  assertSupersedableRunStatus,
} from "./run-binding.js";

const migrationNames = [
  "025_run_intent_bindings.sql",
  "026_run_supersessions.sql",
] as const;

export interface PostgresIntentBoundRunOptions {
  migrate?: boolean;
}

async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const migrationName of migrationNames) {
    const existing = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name=$1",
      [migrationName],
    );
    if ((existing.rowCount ?? 0) > 0) continue;

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
  }
}

async function assertSchemaReady(pool: Pool): Promise<void> {
  const latest = migrationNames[migrationNames.length - 1];
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
    [latest],
  );
  if (result.rows[0]?.count !== "1") {
    throw new Error(`Database schema is not ready; required migration ${latest} is missing.`);
  }
}

async function insertRun(client: PoolClient, run: LatticeRun): Promise<void> {
  await client.query(
    "INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)",
    [
      run.id,
      run.conversationId,
      run.status,
      run.version,
      JSON.stringify(run.request),
      null,
      null,
    ],
  );
  await client.query(
    "INSERT INTO run_events(run_id,sequence,event_type) VALUES ($1,1,'CREATED')",
    [run.id],
  );
}

async function readSupersession(
  client: PoolClient | Pool,
  whereSql: string,
  value: string,
): Promise<RunSupersessionRecord | undefined> {
  const result = await client.query<{
    supersession_id: string;
    predecessor_run_id: string;
    successor_run_id: string;
    intent_scope_id: string;
    predecessor_intent_version_id: string;
    successor_intent_version_id: string;
    created_at: Date | string;
  }>(
    `SELECT supersession_id,predecessor_run_id,successor_run_id,intent_scope_id,
            predecessor_intent_version_id,successor_intent_version_id,created_at
     FROM run_supersessions
     WHERE ${whereSql}=$1`,
    [value],
  );
  const row = result.rows[0];
  return row
    ? {
        supersessionId: row.supersession_id,
        predecessorRunId: row.predecessor_run_id,
        successorRunId: row.successor_run_id,
        intentScopeId: row.intent_scope_id,
        predecessorIntentVersionId: row.predecessor_intent_version_id,
        successorIntentVersionId: row.successor_intent_version_id,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      }
    : undefined;
}

function supersessionMatches(record: RunSupersessionRecord, input: RunSupersessionInput): boolean {
  return record.predecessorRunId === input.predecessorRunId
    && record.successorRunId === input.successorRun.id
    && record.intentScopeId === input.successorBinding.intentScopeId
    && record.successorIntentVersionId === input.successorBinding.intentVersionId;
}

/** Apply exact Run/Intent binding and immutable supersession migrations after prerequisites. */
export async function migrateRunIntentBindings(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query("SELECT 1");
    await applyMigrations(pool);
    await assertSchemaReady(pool);
  } finally {
    await pool.end();
  }
}

/**
 * PostgreSQL exact IntentVersion-bound Run boundary.
 *
 * Normal creation atomically persists Run + binding. Material-correction
 * supersession additionally locks the historical attempt, CAS-cancels it,
 * creates a fresh exact-version successor, and records immutable old/new
 * lineage in the same transaction. No prior decision or V36 state is copied.
 */
export class PostgresIntentBoundRunStore implements IntentBoundRunStore {
  readonly kind = "postgres" as const;

  private constructor(private readonly pool: Pool) {}

  static async connect(
    connectionString: string,
    options: PostgresIntentBoundRunOptions = {},
  ): Promise<PostgresIntentBoundRunStore> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? false) await applyMigrations(pool);
      await assertSchemaReady(pool);
      return new PostgresIntentBoundRunStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async create(run: LatticeRun, binding: RunIntentBindingInput): Promise<RunIntentBinding> {
    assertCanonicalPendingRun(run);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exactVersion = await client.query<{ intent_version_id: string }>(
        `SELECT intent_version_id
         FROM intent_versions
         WHERE intent_scope_id=$1 AND intent_version_id=$2`,
        [binding.intentScopeId, binding.intentVersionId],
      );
      if (!exactVersion.rows[0]) {
        throw new Error("Run must bind an existing exact IntentVersion in the requested IntentScope.");
      }

      await insertRun(client, run);
      const inserted = await client.query<{
        run_id: string;
        intent_scope_id: string;
        intent_version_id: string;
        bound_at: Date | string;
      }>(
        `INSERT INTO run_intent_bindings(run_id,intent_scope_id,intent_version_id)
         VALUES ($1,$2,$3)
         RETURNING run_id,intent_scope_id,intent_version_id,bound_at`,
        [run.id, binding.intentScopeId, binding.intentVersionId],
      );
      await client.query("COMMIT");
      const row = inserted.rows[0];
      if (!row) throw new Error("Exact Run IntentVersion binding was not persisted.");
      return {
        runId: row.run_id,
        intentScopeId: row.intent_scope_id,
        intentVersionId: row.intent_version_id,
        boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : new Date(row.bound_at).toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getBinding(runId: string): Promise<RunIntentBinding | undefined> {
    const result = await this.pool.query<{
      run_id: string;
      intent_scope_id: string;
      intent_version_id: string;
      bound_at: Date | string;
    }>(
      `SELECT run_id,intent_scope_id,intent_version_id,bound_at
       FROM run_intent_bindings
       WHERE run_id=$1`,
      [runId],
    );
    const row = result.rows[0];
    return row
      ? {
          runId: row.run_id,
          intentScopeId: row.intent_scope_id,
          intentVersionId: row.intent_version_id,
          boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : new Date(row.bound_at).toISOString(),
        }
      : undefined;
  }

  async supersede(input: RunSupersessionInput): Promise<RunSupersessionResult> {
    assertSupersedableRunStatus(input.expectedPredecessorStatus);
    assertCanonicalPendingRun(input.successorRun);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const replay = await readSupersession(client, "supersession_id", input.supersessionId);
      if (replay) {
        if (!supersessionMatches(replay, input)) {
          throw new Error("Supersession identity was reused with different Run lineage.");
        }
        await client.query("COMMIT");
        return { outcome: "replayed", record: replay };
      }
      const prior = await readSupersession(client, "predecessor_run_id", input.predecessorRunId);
      if (prior) throw new Error("Run already has an immutable supersession successor.");

      const predecessor = await client.query<{ status: RunStatus; version: string | number }>(
        "SELECT status,version FROM runs WHERE id=$1 FOR UPDATE",
        [input.predecessorRunId],
      );
      const predecessorRow = predecessor.rows[0];
      if (
        !predecessorRow
        || predecessorRow.status !== input.expectedPredecessorStatus
        || Number(predecessorRow.version) !== input.expectedPredecessorVersion
      ) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }

      const predecessorBindingResult = await client.query<{
        intent_scope_id: string;
        intent_version_id: string;
      }>(
        "SELECT intent_scope_id,intent_version_id FROM run_intent_bindings WHERE run_id=$1",
        [input.predecessorRunId],
      );
      const predecessorBinding = predecessorBindingResult.rows[0];
      if (!predecessorBinding) {
        throw new Error("Material-correction supersession requires an exact-bound predecessor Run.");
      }
      if (predecessorBinding.intent_scope_id !== input.successorBinding.intentScopeId) {
        throw new Error("Material-correction successor must remain in the predecessor IntentScope.");
      }
      if (predecessorBinding.intent_version_id === input.successorBinding.intentVersionId) {
        throw new Error("Material-correction successor must bind a new exact IntentVersion.");
      }

      const exactVersion = await client.query<{ intent_version_id: string }>(
        `SELECT intent_version_id
         FROM intent_versions
         WHERE intent_scope_id=$1 AND intent_version_id=$2`,
        [input.successorBinding.intentScopeId, input.successorBinding.intentVersionId],
      );
      if (!exactVersion.rows[0]) {
        throw new Error("Run must bind an existing exact IntentVersion in the requested IntentScope.");
      }

      const cancelled = await client.query<{ version: string | number }>(
        `UPDATE runs
         SET status='CANCELLED',version=version+1,updated_at=now()
         WHERE id=$1 AND status=$2 AND version=$3
         RETURNING version`,
        [input.predecessorRunId, input.expectedPredecessorStatus, input.expectedPredecessorVersion],
      );
      if (!cancelled.rows[0]) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const eventSequence = await client.query<{ sequence: string | number }>(
        "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM run_events WHERE run_id=$1",
        [input.predecessorRunId],
      );
      await client.query(
        "INSERT INTO run_events(run_id,sequence,event_type) VALUES ($1,$2,'CANCELLED')",
        [input.predecessorRunId, Number(eventSequence.rows[0]?.sequence ?? 1)],
      );

      await insertRun(client, input.successorRun);
      await client.query(
        `INSERT INTO run_intent_bindings(run_id,intent_scope_id,intent_version_id)
         VALUES ($1,$2,$3)`,
        [
          input.successorRun.id,
          input.successorBinding.intentScopeId,
          input.successorBinding.intentVersionId,
        ],
      );
      const inserted = await client.query<{
        supersession_id: string;
        predecessor_run_id: string;
        successor_run_id: string;
        intent_scope_id: string;
        predecessor_intent_version_id: string;
        successor_intent_version_id: string;
        created_at: Date | string;
      }>(
        `INSERT INTO run_supersessions(
           supersession_id,predecessor_run_id,successor_run_id,intent_scope_id,
           predecessor_intent_version_id,successor_intent_version_id
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING supersession_id,predecessor_run_id,successor_run_id,intent_scope_id,
                   predecessor_intent_version_id,successor_intent_version_id,created_at`,
        [
          input.supersessionId,
          input.predecessorRunId,
          input.successorRun.id,
          predecessorBinding.intent_scope_id,
          predecessorBinding.intent_version_id,
          input.successorBinding.intentVersionId,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Run supersession lineage was not persisted.");
      await client.query("COMMIT");
      return {
        outcome: "superseded",
        record: {
          supersessionId: row.supersession_id,
          predecessorRunId: row.predecessor_run_id,
          successorRunId: row.successor_run_id,
          intentScopeId: row.intent_scope_id,
          predecessorIntentVersionId: row.predecessor_intent_version_id,
          successorIntentVersionId: row.successor_intent_version_id,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSupersession(predecessorRunId: string): Promise<RunSupersessionRecord | undefined> {
    return readSupersession(this.pool, "predecessor_run_id", predecessorRunId);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
