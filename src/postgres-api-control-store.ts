import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import type {
  ApiAcceptedRunResponse,
  ApiIdempotencyInput,
  ApiRunControlStore,
  ApiRunSubmissionInput,
  ApiRunSubmissionResult,
  ApiRunSupersessionInput,
  ApiRunSupersessionResult,
  ApiSupersededRunResponse,
} from "./api-control-store.js";
import type { LatticeRun, RunStatus } from "./domain.js";
import {
  assertCanonicalPendingRun,
  assertSupersedableRunStatus,
  type RunIntentBindingInput,
  type RunSupersessionRecord,
} from "./intent/run-binding.js";

const migration = "019_api_idempotency.sql" as const;

type IdempotencyRow = {
  request_hash: string;
  response_json: ApiAcceptedRunResponse;
};

async function applyMigration(pool: Pool): Promise<void> {
  const base = await pool.query<{ runs: string | null; events: string | null; outbox: string | null; registry: string | null }>(
    `SELECT
       to_regclass('public.runs')::text AS runs,
       to_regclass('public.run_events')::text AS events,
       to_regclass('public.dispatch_outbox')::text AS outbox,
       to_regclass('public.schema_migrations')::text AS registry`,
  );
  const row = base.rows[0];
  if (!row?.runs || !row.events || !row.outbox || !row.registry) {
    throw new Error("Base Run/event/outbox schema must be initialized before API control migration.");
  }
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
}

async function assertReady(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
    [migration],
  );
  if (result.rows[0]?.count !== "1") {
    throw new Error(`API control schema is not ready; required migration ${migration} is missing.`);
  }
}

function acceptedResponse(run: LatticeRun): ApiAcceptedRunResponse {
  return { runId: run.id, status: "CREATED" };
}

function supersededResponse(record: RunSupersessionRecord): ApiSupersededRunResponse {
  return {
    runId: record.successorRunId,
    status: "CREATED",
    supersededRunId: record.predecessorRunId,
    supersessionId: record.supersessionId,
  };
}

async function readIdempotency(pool: Pool, input: ApiIdempotencyInput): Promise<IdempotencyRow | undefined> {
  const result = await pool.query<IdempotencyRow>(
    `SELECT request_hash,response_json
     FROM api_idempotency_keys
     WHERE scope_key=$1 AND http_method=$2 AND canonical_route=$3 AND idempotency_key=$4
       AND expires_at > now()`,
    [input.scopeKey, input.httpMethod, input.canonicalRoute, input.idempotencyKey],
  );
  return result.rows[0];
}

async function insertRun(client: PoolClient, run: LatticeRun): Promise<void> {
  await client.query(
    `INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      run.id,
      run.conversationId,
      run.status,
      run.version,
      JSON.stringify(run.request),
      run.decision === null ? null : JSON.stringify(run.decision),
      run.explanation,
    ],
  );
  for (const event of run.events) {
    await client.query(
      "INSERT INTO run_events(run_id,sequence,event_type) VALUES ($1,$2,$3)",
      [run.id, event.sequence, event.type],
    );
  }
}

async function insertIntentBinding(
  client: PoolClient,
  runId: string,
  binding: RunIntentBindingInput,
): Promise<void> {
  const exactVersion = await client.query<{ intent_version_id: string }>(
    `SELECT intent_version_id
     FROM intent_versions
     WHERE intent_scope_id=$1 AND intent_version_id=$2`,
    [binding.intentScopeId, binding.intentVersionId],
  );
  if (!exactVersion.rows[0]) {
    throw new Error("Run must bind an existing exact IntentVersion in the requested IntentScope.");
  }
  await client.query(
    `INSERT INTO run_intent_bindings(run_id,intent_scope_id,intent_version_id)
     VALUES ($1,$2,$3)`,
    [runId, binding.intentScopeId, binding.intentVersionId],
  );
}

async function readSupersession(
  client: PoolClient,
  column: "supersession_id" | "predecessor_run_id",
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
     WHERE ${column}=$1`,
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

function supersessionMatches(record: RunSupersessionRecord, input: ApiRunSupersessionInput): boolean {
  const supersession = input.supersession;
  return record.predecessorRunId === supersession.predecessorRunId
    && record.successorRunId === supersession.successorRun.id
    && record.intentScopeId === supersession.successorBinding.intentScopeId
    && record.successorIntentVersionId === supersession.successorBinding.intentVersionId;
}

/**
 * PostgreSQL API mutation boundary. It is intentionally separate from V36 and
 * from worker execution: its job is to atomically accept durable Runs, record
 * idempotent HTTP responses, emit Run dispatch intents, persist exact
 * authoritative IntentVersion bindings, and atomically supersede an exact-bound
 * historical attempt when an upstream Product authority has already established
 * a material correction and exact successor IntentVersion.
 */
export class PostgresApiRunControlStore implements ApiRunControlStore {
  private constructor(private readonly pool: Pool) {}

  static async connect(
    connectionString: string,
    options: { migrate?: boolean } = {},
  ): Promise<PostgresApiRunControlStore> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? true) await applyMigration(pool);
      await assertReady(pool);
      return new PostgresApiRunControlStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    const response = acceptedResponse(input.run);
    if (input.idempotency) {
      const existing = await readIdempotency(this.pool, input.idempotency);
      if (existing) {
        return existing.request_hash === input.idempotency.requestHash
          ? { outcome: "existing", response: existing.response_json }
          : { outcome: "conflict" };
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.idempotency) {
        await client.query(
          `DELETE FROM api_idempotency_keys
           WHERE scope_key=$1 AND http_method=$2 AND canonical_route=$3 AND idempotency_key=$4
             AND expires_at <= now()`,
          [
            input.idempotency.scopeKey,
            input.idempotency.httpMethod,
            input.idempotency.canonicalRoute,
            input.idempotency.idempotencyKey,
          ],
        );
      }

      await insertRun(client, input.run);
      if (input.intentBinding) {
        await insertIntentBinding(client, input.run.id, input.intentBinding);
      }

      if (input.idempotency) {
        const inserted = await client.query(
          `INSERT INTO api_idempotency_keys(
             scope_key,http_method,canonical_route,idempotency_key,request_hash,
             response_status,response_json,run_id,expires_at
           ) VALUES ($1,$2,$3,$4,$5,202,$6::jsonb,$7,$8)
           ON CONFLICT (scope_key,http_method,canonical_route,idempotency_key) DO NOTHING`,
          [
            input.idempotency.scopeKey,
            input.idempotency.httpMethod,
            input.idempotency.canonicalRoute,
            input.idempotency.idempotencyKey,
            input.idempotency.requestHash,
            JSON.stringify(response),
            input.run.id,
            input.idempotency.expiresAt,
          ],
        );
        if ((inserted.rowCount ?? 0) !== 1) {
          await client.query("ROLLBACK");
          const raced = await readIdempotency(this.pool, input.idempotency);
          if (!raced) throw new Error("Concurrent API idempotency conflict produced no durable response record.");
          return raced.request_hash === input.idempotency.requestHash
            ? { outcome: "existing", response: raced.response_json }
            : { outcome: "conflict" };
        }
      }

      await client.query(
        `INSERT INTO dispatch_outbox(logical_key,run_id,queue_name,payload,available_at)
         VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,now()))`,
        [
          input.dispatch.logicalKey,
          input.run.id,
          input.dispatch.queueName,
          JSON.stringify(input.dispatch.payload),
          input.dispatch.availableAt ?? null,
        ],
      );
      await client.query("COMMIT");
      return { outcome: "created", response };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const supersession = input.supersession;
    assertSupersedableRunStatus(supersession.expectedPredecessorStatus);
    assertCanonicalPendingRun(supersession.successorRun);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const replay = await readSupersession(client, "supersession_id", supersession.supersessionId);
      if (replay) {
        if (!supersessionMatches(replay, input)) {
          throw new Error("Supersession identity was reused with different Run lineage.");
        }
        await client.query("COMMIT");
        return { outcome: "replayed", response: supersededResponse(replay), record: replay };
      }
      const prior = await readSupersession(client, "predecessor_run_id", supersession.predecessorRunId);
      if (prior) throw new Error("Run already has an immutable supersession successor.");

      const predecessor = await client.query<{ status: RunStatus; version: string | number }>(
        "SELECT status,version FROM runs WHERE id=$1 FOR UPDATE",
        [supersession.predecessorRunId],
      );
      const predecessorRow = predecessor.rows[0];
      if (
        !predecessorRow
        || predecessorRow.status !== supersession.expectedPredecessorStatus
        || Number(predecessorRow.version) !== supersession.expectedPredecessorVersion
      ) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }

      const predecessorBindingResult = await client.query<{
        intent_scope_id: string;
        intent_version_id: string;
      }>(
        "SELECT intent_scope_id,intent_version_id FROM run_intent_bindings WHERE run_id=$1",
        [supersession.predecessorRunId],
      );
      const predecessorBinding = predecessorBindingResult.rows[0];
      if (!predecessorBinding) {
        throw new Error("Material-correction supersession requires an exact-bound predecessor Run.");
      }
      if (predecessorBinding.intent_scope_id !== supersession.successorBinding.intentScopeId) {
        throw new Error("Material-correction successor must remain in the predecessor IntentScope.");
      }
      if (predecessorBinding.intent_version_id === supersession.successorBinding.intentVersionId) {
        throw new Error("Material-correction successor must bind a new exact IntentVersion.");
      }

      const exactVersion = await client.query<{ intent_version_id: string }>(
        `SELECT intent_version_id
         FROM intent_versions
         WHERE intent_scope_id=$1 AND intent_version_id=$2`,
        [supersession.successorBinding.intentScopeId, supersession.successorBinding.intentVersionId],
      );
      if (!exactVersion.rows[0]) {
        throw new Error("Run must bind an existing exact IntentVersion in the requested IntentScope.");
      }

      const cancelled = await client.query<{ version: string | number }>(
        `UPDATE runs
         SET status='CANCELLED',version=version+1,updated_at=now()
         WHERE id=$1 AND status=$2 AND version=$3
         RETURNING version`,
        [
          supersession.predecessorRunId,
          supersession.expectedPredecessorStatus,
          supersession.expectedPredecessorVersion,
        ],
      );
      if (!cancelled.rows[0]) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const eventSequence = await client.query<{ sequence: string | number }>(
        "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM run_events WHERE run_id=$1",
        [supersession.predecessorRunId],
      );
      await client.query(
        "INSERT INTO run_events(run_id,sequence,event_type) VALUES ($1,$2,'CANCELLED')",
        [supersession.predecessorRunId, Number(eventSequence.rows[0]?.sequence ?? 1)],
      );

      await insertRun(client, supersession.successorRun);
      await client.query(
        `INSERT INTO run_intent_bindings(run_id,intent_scope_id,intent_version_id)
         VALUES ($1,$2,$3)`,
        [
          supersession.successorRun.id,
          supersession.successorBinding.intentScopeId,
          supersession.successorBinding.intentVersionId,
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
          supersession.supersessionId,
          supersession.predecessorRunId,
          supersession.successorRun.id,
          predecessorBinding.intent_scope_id,
          predecessorBinding.intent_version_id,
          supersession.successorBinding.intentVersionId,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Run supersession lineage was not persisted.");
      const record: RunSupersessionRecord = {
        supersessionId: row.supersession_id,
        predecessorRunId: row.predecessor_run_id,
        successorRunId: row.successor_run_id,
        intentScopeId: row.intent_scope_id,
        predecessorIntentVersionId: row.predecessor_intent_version_id,
        successorIntentVersionId: row.successor_intent_version_id,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      };

      await client.query(
        `INSERT INTO dispatch_outbox(logical_key,run_id,queue_name,payload,available_at)
         VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,now()))`,
        [
          input.dispatch.logicalKey,
          supersession.successorRun.id,
          input.dispatch.queueName,
          JSON.stringify(input.dispatch.payload),
          input.dispatch.availableAt ?? null,
        ],
      );

      await client.query("COMMIT");
      return { outcome: "superseded", response: supersededResponse(record), record };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
