import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { RunStatus } from "./domain.js";
import {
  createResearchTaskFingerprint,
  type DurableResearchTask,
  type ResearchTaskDefinition,
} from "./orchestration-store.js";
import { PostgresOrchestrationStore } from "./postgres-orchestration-store.js";
import {
  assertV36ResearchCheckpointIntegrity,
  type V36NeedsResearch,
  type V36ResearchCheckpoint,
  type V36ResearchRequest,
} from "./truth/continuation.js";

const migrationName = "020_v36_research_continuations.sql";

export type DurableV36ExecutionResult =
  | {
      requestId: string;
      runId: string;
      outcome: "SUCCEEDED";
      result: unknown;
      operationalFailure: null;
    }
  | {
      requestId: string;
      runId: string;
      outcome: "OPERATIONAL_FAILURE";
      result: null;
      operationalFailure: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };

export type DurableV36ContinuationLoadResult =
  | { outcome: "missing" }
  | { outcome: "stale" }
  | { outcome: "pending"; checkpoint: V36ResearchCheckpoint }
  | {
      outcome: "ready";
      checkpoint: V36ResearchCheckpoint;
      results: DurableV36ExecutionResult[];
    };

export type ScheduleDurableV36ContinuationResult =
  | {
      outcome: "scheduled";
      checkpointHash: string;
      tasks: DurableResearchTask[];
    }
  | { outcome: "stale" };

type TaskBinding = {
  requestId: string;
  taskFingerprint: string;
};

type ContinuationRow = {
  run_id: string;
  run_epoch: string | number;
  run_status: RunStatus;
  checkpoint_hash: string;
  checkpoint_json: V36ResearchCheckpoint;
  research_requests_json: V36ResearchRequest[];
  task_bindings_json: TaskBinding[];
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return entry;
  });
}

function requestInputs(checkpointHash: string, request: V36ResearchRequest): unknown {
  return {
    kind: "V36_RESEARCH_REQUEST",
    checkpointHash,
    request: {
      id: request.id,
      runId: request.runId,
      claimId: request.claimId,
      parentRequestId: request.parentRequestId,
      purpose: request.purpose,
      query: request.query,
      serialRound: request.serialRound,
    },
  };
}

export function defineV36ContinuationTasks(
  checkpoint: V36ResearchCheckpoint,
): { tasks: ResearchTaskDefinition[]; bindings: TaskBinding[] } {
  assertV36ResearchCheckpointIntegrity(checkpoint);
  const contextVersionIds = [`v36-checkpoint:${checkpoint.checkpointHash}`];
  const fingerprintByRequest = new Map<string, string>();

  for (const request of checkpoint.researchRequests) {
    fingerprintByRequest.set(request.id, createResearchTaskFingerprint({
      runId: checkpoint.runId,
      planVersion: checkpoint.round,
      normalizedInputs: requestInputs(checkpoint.checkpointHash, request),
      contextVersionIds,
    }));
  }

  const tasks = checkpoint.researchRequests.map<ResearchTaskDefinition>((request) => {
    const taskFingerprint = fingerprintByRequest.get(request.id);
    if (!taskFingerprint) throw new Error(`Missing durable task fingerprint for ${request.id}.`);
    const inCheckpointParent = request.parentRequestId === null
      ? undefined
      : fingerprintByRequest.get(request.parentRequestId);
    return {
      taskFingerprint,
      planVersion: checkpoint.round,
      normalizedInputs: requestInputs(checkpoint.checkpointHash, request),
      contextVersionIds,
      dependsOn: inCheckpointParent === undefined ? [] : [inCheckpointParent],
      maxAttempts: 1,
    };
  });

  return {
    tasks,
    bindings: checkpoint.researchRequests.map((request) => ({
      requestId: request.id,
      taskFingerprint: fingerprintByRequest.get(request.id)!,
    })),
  };
}

async function applyMigration(pool: Pool): Promise<void> {
  const base = await pool.query<{ runs: string | null; tasks: string | null; registry: string | null }>(
    `SELECT
       to_regclass('public.runs')::text AS runs,
       to_regclass('public.run_tasks')::text AS tasks,
       to_regclass('public.schema_migrations')::text AS registry`,
  );
  const row = base.rows[0];
  if (!row?.runs || !row.tasks || !row.registry) {
    throw new Error("Run and durable research-task schemas must exist before the V36 continuation bridge migration.");
  }
  const existing = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations WHERE name=$1",
    [migrationName],
  );
  if ((existing.rowCount ?? 0) > 0) return;

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

async function assertSchemaReady(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
    [migrationName],
  );
  if (result.rows[0]?.count !== "1") {
    throw new Error(`V36 durable continuation schema is not ready; required migration ${migrationName} is missing.`);
  }
}

function continuationMatches(
  row: ContinuationRow,
  checkpoint: V36ResearchCheckpoint,
  requests: readonly V36ResearchRequest[],
  bindings: readonly TaskBinding[],
  expectedStatus: RunStatus,
  expectedVersion: number,
): boolean {
  return row.run_id === checkpoint.runId
    && Number(row.run_epoch) === expectedVersion
    && row.run_status === expectedStatus
    && row.checkpoint_hash === checkpoint.checkpointHash
    && stableJson(row.checkpoint_json) === stableJson(checkpoint)
    && stableJson(row.research_requests_json) === stableJson(requests)
    && stableJson(row.task_bindings_json) === stableJson(bindings);
}

export class PostgresV36ResearchBridge {
  private constructor(
    private readonly pool: Pool,
    private readonly orchestration: PostgresOrchestrationStore,
  ) {}

  static async connect(
    connectionString: string,
    options: { migrate?: boolean } = {},
  ): Promise<PostgresV36ResearchBridge> {
    const pool = new Pool({ connectionString });
    let orchestration: PostgresOrchestrationStore | undefined;
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? true) await applyMigration(pool);
      await assertSchemaReady(pool);
      orchestration = await PostgresOrchestrationStore.connect(connectionString, { migrate: false });
      return new PostgresV36ResearchBridge(pool, orchestration);
    } catch (error) {
      if (orchestration) await orchestration.close();
      await pool.end();
      throw error;
    }
  }

  static async migrate(connectionString: string): Promise<void> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await applyMigration(pool);
      await assertSchemaReady(pool);
    } finally {
      await pool.end();
    }
  }

  async schedule(input: {
    yielded: V36NeedsResearch;
    expectedStatus: RunStatus;
    expectedVersion: number;
  }): Promise<ScheduleDurableV36ContinuationResult> {
    assertV36ResearchCheckpointIntegrity(input.yielded.checkpoint);
    if (stableJson(input.yielded.researchRequests) !== stableJson(input.yielded.checkpoint.researchRequests)) {
      throw new Error("V36 yielded research requests do not match the immutable checkpoint.");
    }
    if (input.expectedVersion <= 0 || !Number.isSafeInteger(input.expectedVersion)) {
      throw new Error("Expected Run version must be a positive integer.");
    }

    const { tasks, bindings } = defineV36ContinuationTasks(input.yielded.checkpoint);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await client.query<{ status: RunStatus; version: string | number }>(
        "SELECT status,version FROM runs WHERE id=$1 FOR UPDATE",
        [input.yielded.checkpoint.runId],
      );
      const state = run.rows[0];
      if (!state || state.status !== input.expectedStatus || Number(state.version) !== input.expectedVersion) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }

      await client.query(
        `INSERT INTO v36_research_continuations(
           run_id,run_epoch,run_status,checkpoint_hash,checkpoint_json,research_requests_json,task_bindings_json
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
         ON CONFLICT (run_id,checkpoint_hash) DO NOTHING`,
        [
          input.yielded.checkpoint.runId,
          input.expectedVersion,
          input.expectedStatus,
          input.yielded.checkpoint.checkpointHash,
          JSON.stringify(input.yielded.checkpoint),
          JSON.stringify(input.yielded.researchRequests),
          JSON.stringify(bindings),
        ],
      );
      const persisted = await client.query<ContinuationRow>(
        `SELECT run_id,run_epoch,run_status,checkpoint_hash,checkpoint_json,research_requests_json,task_bindings_json
         FROM v36_research_continuations WHERE run_id=$1 AND checkpoint_hash=$2`,
        [input.yielded.checkpoint.runId, input.yielded.checkpoint.checkpointHash],
      );
      const persistedRow = persisted.rows[0];
      if (!persistedRow || !continuationMatches(
        persistedRow,
        input.yielded.checkpoint,
        input.yielded.researchRequests,
        bindings,
        input.expectedStatus,
        input.expectedVersion,
      )) {
        throw new Error("Durable V36 continuation checkpoint is already bound to different immutable state.");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const scheduled = await this.orchestration.scheduleResearchGraph({
      runId: input.yielded.checkpoint.runId,
      expectedStatus: input.expectedStatus,
      expectedVersion: input.expectedVersion,
      tasks,
    });
    if (scheduled.outcome === "stale") return scheduled;
    return {
      outcome: "scheduled",
      checkpointHash: input.yielded.checkpoint.checkpointHash,
      tasks: scheduled.tasks,
    };
  }

  private async readRow(runId: string, checkpointHash: string): Promise<ContinuationRow | undefined> {
    const result = await this.pool.query<ContinuationRow>(
      `SELECT run_id,run_epoch,run_status,checkpoint_hash,checkpoint_json,research_requests_json,task_bindings_json
       FROM v36_research_continuations WHERE run_id=$1 AND checkpoint_hash=$2`,
      [runId, checkpointHash],
    );
    return result.rows[0];
  }

  async load(
    runId: string,
    checkpointHash: string,
  ): Promise<DurableV36ContinuationLoadResult> {
    const row = await this.readRow(runId, checkpointHash);
    if (!row) return { outcome: "missing" };
    assertV36ResearchCheckpointIntegrity(row.checkpoint_json);
    if (
      row.run_id !== row.checkpoint_json.runId
      || row.checkpoint_hash !== row.checkpoint_json.checkpointHash
      || stableJson(row.research_requests_json) !== stableJson(row.checkpoint_json.researchRequests)
    ) {
      throw new Error("Persisted V36 continuation state does not match its immutable checkpoint.");
    }

    const { tasks, bindings } = defineV36ContinuationTasks(row.checkpoint_json);
    if (stableJson(bindings) !== stableJson(row.task_bindings_json)) {
      throw new Error("Persisted V36 continuation task bindings do not match its immutable checkpoint.");
    }

    const scheduled = await this.orchestration.scheduleResearchGraph({
      runId,
      expectedStatus: row.run_status,
      expectedVersion: Number(row.run_epoch),
      tasks,
    });
    if (scheduled.outcome === "stale") return { outcome: "stale" };

    const taskByFingerprint = new Map(
      scheduled.tasks.map((task) => [task.taskFingerprint, task] as const),
    );
    const taskByRequest = new Map<string, DurableResearchTask>();
    for (const binding of row.task_bindings_json) {
      const task = taskByFingerprint.get(binding.taskFingerprint);
      if (!task) throw new Error(`Durable research task disappeared for request ${binding.requestId}.`);
      taskByRequest.set(binding.requestId, task);
    }

    const failureByRequest = new Map<string, DurableV36ExecutionResult & { outcome: "OPERATIONAL_FAILURE" }>();
    const resolveFailure = (
      request: V36ResearchRequest,
      visiting = new Set<string>(),
    ): (DurableV36ExecutionResult & { outcome: "OPERATIONAL_FAILURE" }) | undefined => {
      const existing = failureByRequest.get(request.id);
      if (existing) return existing;
      if (visiting.has(request.id)) throw new Error("Persisted V36 continuation contains a request dependency cycle.");
      visiting.add(request.id);
      const task = taskByRequest.get(request.id);
      if (!task) throw new Error(`Durable research task missing for request ${request.id}.`);
      let failure: (DurableV36ExecutionResult & { outcome: "OPERATIONAL_FAILURE" }) | undefined;
      if (task.status === "FAILED" || task.status === "CANCELLED") {
        failure = {
          requestId: request.id,
          runId,
          outcome: "OPERATIONAL_FAILURE",
          result: null,
          operationalFailure: {
            code: task.status === "FAILED" ? "RESEARCH_TASK_EXHAUSTED" : "RESEARCH_TASK_CANCELLED",
            message: task.status === "FAILED"
              ? "Durable research task exhausted without an accepted result."
              : "Durable research task was cancelled before producing an accepted result.",
            retryable: false,
          },
        };
      } else if (request.parentRequestId !== null && task.status !== "SUCCEEDED") {
        const parent = row.research_requests_json.find((candidate) => candidate.id === request.parentRequestId);
        if (parent) {
          const parentFailure = resolveFailure(parent, visiting);
          if (parentFailure) {
            failure = {
              requestId: request.id,
              runId,
              outcome: "OPERATIONAL_FAILURE",
              result: null,
              operationalFailure: {
                code: "RESEARCH_DEPENDENCY_FAILED",
                message: `Durable research dependency ${request.parentRequestId} did not produce an accepted result.`,
                retryable: false,
              },
            };
          }
        }
      }
      visiting.delete(request.id);
      if (failure) failureByRequest.set(request.id, failure);
      return failure;
    };

    let pending = false;
    const results: DurableV36ExecutionResult[] = [];
    for (const request of row.research_requests_json) {
      const task = taskByRequest.get(request.id);
      if (!task) throw new Error(`Durable research task missing for request ${request.id}.`);
      if (task.status === "SUCCEEDED") {
        if (task.acceptedResult === null) {
          throw new Error(`Succeeded durable research task ${task.id} has no accepted result.`);
        }
        results.push({
          requestId: request.id,
          runId,
          outcome: "SUCCEEDED",
          result: structuredClone(task.acceptedResult),
          operationalFailure: null,
        });
        continue;
      }
      const failure = resolveFailure(request);
      if (failure) {
        results.push(failure);
      } else {
        pending = true;
      }
    }

    if (pending) {
      return { outcome: "pending", checkpoint: structuredClone(row.checkpoint_json) };
    }
    return {
      outcome: "ready",
      checkpoint: structuredClone(row.checkpoint_json),
      results,
    };
  }

  async close(): Promise<void> {
    await this.orchestration.close();
    await this.pool.end();
  }
}