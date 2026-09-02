import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import type { RunStatus } from "./domain.js";
import {
  assertResearchTaskGraph,
  type ClaimResearchTaskResult,
  type CompleteResearchTaskResult,
  type DispatchEnvelope,
  type DispatchMutationResult,
  type DurableOrchestrationStore,
  type DurableResearchAttempt,
  type DurableResearchTask,
  type FailResearchTaskResult,
  type ResearchTaskDefinition,
  type ResearchTaskStatus,
  type ScheduleResearchGraphInput,
  type ScheduleResearchGraphResult,
} from "./orchestration-store.js";

const orchestrationMigrations = [
  "017_durable_research_tasks.sql",
  "018_dispatch_outbox_leases.sql",
] as const;

function isTerminal(status: RunStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "FAILED";
}

async function applyOrchestrationMigrations(pool: Pool): Promise<void> {
  const base = await pool.query<{ runs: string | null; outbox: string | null; registry: string | null }>(
    `SELECT
       to_regclass('public.runs')::text AS runs,
       to_regclass('public.dispatch_outbox')::text AS outbox,
       to_regclass('public.schema_migrations')::text AS registry`,
  );
  const row = base.rows[0];
  if (!row?.runs || !row.outbox || !row.registry) {
    throw new Error("Base Run/outbox schema must be initialized before durable orchestration migrations.");
  }
  for (const name of orchestrationMigrations) {
    const existing = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = $1",
      [name],
    );
    if ((existing.rowCount ?? 0) > 0) continue;
    const sql = await readFile(resolve(process.cwd(), "migrations", name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertOrchestrationSchemaReady(pool: Pool): Promise<void> {
  const latest = orchestrationMigrations[orchestrationMigrations.length - 1];
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name = $1",
    [latest],
  );
  if (result.rows[0]?.count !== "1") {
    throw new Error(`Durable orchestration schema is not ready; required migration ${latest} is missing.`);
  }
}

type TaskRow = {
  id: string;
  run_id: string;
  task_fingerprint: string;
  plan_version: number;
  task_type: "RESEARCH";
  input_json: unknown;
  context_version_ids_json: string[];
  run_epoch: string | number;
  status: ResearchTaskStatus;
  max_attempts: number;
  attempt_count: number;
  current_attempt: number | null;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  accepted_result_json: unknown | null;
};

type AttemptRow = {
  task_id: string;
  attempt_number: number;
  worker_id: string;
  status: DurableResearchAttempt["status"];
  lease_expires_at: Date | string;
  result_json: unknown | null;
  error_text: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
};

type OutboxRow = {
  id: string | number;
  logical_key: string;
  run_id: string;
  queue_name: string;
  payload: unknown;
  available_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  delivery_attempts: number;
  dispatched_at: Date | string | null;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function taskFromRow(row: TaskRow, dependsOn: string[]): DurableResearchTask {
  return {
    id: row.id,
    runId: row.run_id,
    taskFingerprint: row.task_fingerprint,
    planVersion: Number(row.plan_version),
    taskType: row.task_type,
    input: row.input_json,
    contextVersionIds: row.context_version_ids_json,
    dependsOn,
    runEpoch: Number(row.run_epoch),
    status: row.status,
    maxAttempts: Number(row.max_attempts),
    attemptCount: Number(row.attempt_count),
    currentAttempt: row.current_attempt === null ? null : Number(row.current_attempt),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    acceptedResult: row.accepted_result_json,
  };
}

function attemptFromRow(row: AttemptRow): DurableResearchAttempt {
  return {
    taskId: row.task_id,
    attemptNumber: Number(row.attempt_number),
    workerId: row.worker_id,
    status: row.status,
    leaseExpiresAt: iso(row.lease_expires_at) ?? "",
    result: row.result_json,
    error: row.error_text,
    startedAt: iso(row.started_at) ?? "",
    completedAt: iso(row.completed_at),
  };
}

function outboxFromRow(row: OutboxRow): DispatchEnvelope {
  return {
    id: Number(row.id),
    logicalKey: row.logical_key,
    runId: row.run_id,
    queueName: row.queue_name,
    payload: row.payload,
    availableAt: iso(row.available_at) ?? "",
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    deliveryAttempts: Number(row.delivery_attempts),
    dispatchedAt: iso(row.dispatched_at),
  };
}

async function taskDependencies(client: PoolClient, taskId: string): Promise<string[]> {
  const result = await client.query<{ task_fingerprint: string }>(
    `SELECT dependency.task_fingerprint
     FROM run_task_dependencies edge
     JOIN run_tasks dependency ON dependency.id = edge.depends_on_task_id
     WHERE edge.task_id = $1
     ORDER BY dependency.task_fingerprint`,
    [taskId],
  );
  return result.rows.map((row) => row.task_fingerprint);
}

async function loadTask(client: PoolClient, taskId: string, lock = false): Promise<DurableResearchTask | undefined> {
  const result = await client.query<TaskRow>(
    `SELECT id,run_id,task_fingerprint,plan_version,task_type,input_json,context_version_ids_json,
            run_epoch,status,max_attempts,attempt_count,current_attempt,lease_owner,lease_expires_at,
            accepted_result_json
     FROM run_tasks WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return taskFromRow(row, await taskDependencies(client, taskId));
}

async function taskRunId(client: PoolClient, taskId: string): Promise<string | undefined> {
  const result = await client.query<{ run_id: string }>(
    "SELECT run_id FROM run_tasks WHERE id=$1",
    [taskId],
  );
  return result.rows[0]?.run_id;
}

async function runState(client: PoolClient, runId: string, lock = false): Promise<{ status: RunStatus; version: number } | undefined> {
  const result = await client.query<{ status: RunStatus; version: string | number }>(
    `SELECT status,version FROM runs WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [runId],
  );
  const row = result.rows[0];
  return row ? { status: row.status, version: Number(row.version) } : undefined;
}

async function dependenciesSatisfied(client: PoolClient, taskId: string): Promise<boolean> {
  const result = await client.query<{ blockers: string }>(
    `SELECT count(*)::text AS blockers
     FROM run_task_dependencies edge
     JOIN run_tasks dependency ON dependency.id = edge.depends_on_task_id
     WHERE edge.task_id=$1 AND dependency.status <> 'SUCCEEDED'`,
    [taskId],
  );
  return result.rows[0]?.blockers === "0";
}

async function insertOutbox(
  client: PoolClient,
  logicalKey: string,
  runId: string,
  queueName: string,
  payload: unknown,
  availableAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO dispatch_outbox(logical_key,run_id,queue_name,payload,available_at)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (logical_key) DO NOTHING`,
    [logicalKey, runId, queueName, JSON.stringify(payload), availableAt],
  );
}

async function enqueueReadyDependents(client: PoolClient, task: DurableResearchTask, now: Date): Promise<void> {
  const dependents = await client.query<{ id: string; task_fingerprint: string; run_epoch: string | number; attempt_count: number }>(
    `SELECT candidate.id,candidate.task_fingerprint,candidate.run_epoch,candidate.attempt_count
     FROM run_task_dependencies trigger_edge
     JOIN run_tasks candidate ON candidate.id = trigger_edge.task_id
     WHERE trigger_edge.depends_on_task_id=$1
       AND candidate.status='PENDING'
       AND NOT EXISTS (
         SELECT 1
         FROM run_task_dependencies blocker_edge
         JOIN run_tasks blocker ON blocker.id=blocker_edge.depends_on_task_id
         WHERE blocker_edge.task_id=candidate.id AND blocker.status <> 'SUCCEEDED'
       )`,
    [task.id],
  );
  for (const dependent of dependents.rows) {
    const nextAttempt = Number(dependent.attempt_count) + 1;
    await insertOutbox(
      client,
      `research-task:${dependent.id}:attempt:${nextAttempt}`,
      task.runId,
      "lattice.research",
      {
        taskId: dependent.id,
        taskFingerprint: dependent.task_fingerprint,
        runEpoch: Number(dependent.run_epoch),
      },
      now,
    );
  }
}

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

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function definitionMatches(task: DurableResearchTask, definition: ResearchTaskDefinition, runEpoch: number): boolean {
  return task.planVersion === definition.planVersion
    && sameJson(task.input, definition.normalizedInputs)
    && sameJson(task.contextVersionIds, [...definition.contextVersionIds].sort())
    && sameJson(task.dependsOn, [...definition.dependsOn].sort())
    && task.maxAttempts === definition.maxAttempts
    && task.runEpoch === runEpoch;
}

export class PostgresOrchestrationStore implements DurableOrchestrationStore {
  private constructor(private readonly pool: Pool) {}

  static async connect(connectionString: string, options: { migrate?: boolean } = {}): Promise<PostgresOrchestrationStore> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? true) await applyOrchestrationMigrations(pool);
      await assertOrchestrationSchemaReady(pool);
      return new PostgresOrchestrationStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async scheduleResearchGraph(input: ScheduleResearchGraphInput): Promise<ScheduleResearchGraphResult> {
    assertResearchTaskGraph(input.tasks);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await runState(client, input.runId, true);
      if (!run || run.status !== input.expectedStatus || run.version !== input.expectedVersion || isTerminal(run.status)) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }

      const byFingerprint = new Map<string, DurableResearchTask>();
      for (const definition of input.tasks) {
        const existing = await client.query<TaskRow>(
          `SELECT id,run_id,task_fingerprint,plan_version,task_type,input_json,context_version_ids_json,
                  run_epoch,status,max_attempts,attempt_count,current_attempt,lease_owner,lease_expires_at,
                  accepted_result_json
           FROM run_tasks WHERE run_id=$1 AND task_fingerprint=$2 FOR UPDATE`,
          [input.runId, definition.taskFingerprint],
        );
        if (existing.rows[0]) {
          const provisional = taskFromRow(existing.rows[0], []);
          byFingerprint.set(definition.taskFingerprint, provisional);
          continue;
        }
        const id = randomUUID();
        const inserted = await client.query<TaskRow>(
          `INSERT INTO run_tasks(
             id,run_id,task_fingerprint,plan_version,task_type,input_json,context_version_ids_json,
             run_epoch,max_attempts
           ) VALUES ($1,$2,$3,$4,'RESEARCH',$5::jsonb,$6::jsonb,$7,$8)
           RETURNING id,run_id,task_fingerprint,plan_version,task_type,input_json,context_version_ids_json,
                     run_epoch,status,max_attempts,attempt_count,current_attempt,lease_owner,lease_expires_at,
                     accepted_result_json`,
          [
            id,
            input.runId,
            definition.taskFingerprint,
            definition.planVersion,
            JSON.stringify(definition.normalizedInputs),
            JSON.stringify([...definition.contextVersionIds].sort()),
            input.expectedVersion,
            definition.maxAttempts,
          ],
        );
        byFingerprint.set(definition.taskFingerprint, taskFromRow(inserted.rows[0]!, []));
      }

      for (const definition of input.tasks) {
        const task = byFingerprint.get(definition.taskFingerprint);
        if (!task) throw new Error("Research task graph materialization lost a task.");
        for (const dependencyFingerprint of definition.dependsOn) {
          const dependency = byFingerprint.get(dependencyFingerprint);
          if (!dependency) throw new Error("Research task graph materialization lost a dependency.");
          await client.query(
            `INSERT INTO run_task_dependencies(run_id,task_id,depends_on_task_id)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [input.runId, task.id, dependency.id],
          );
        }
      }

      const materialized: DurableResearchTask[] = [];
      for (const definition of input.tasks) {
        const task = byFingerprint.get(definition.taskFingerprint);
        if (!task) throw new Error("Research task graph materialization lost a task.");
        const withDependencies = await loadTask(client, task.id, true);
        if (!withDependencies) throw new Error("Research task disappeared during graph scheduling.");
        if (!definitionMatches(withDependencies, definition, input.expectedVersion)) {
          throw new Error(`Research task fingerprint ${definition.taskFingerprint} collided with different task state.`);
        }
        materialized.push(withDependencies);
        if (withDependencies.status === "PENDING" && withDependencies.dependsOn.length === 0) {
          await insertOutbox(
            client,
            `research-task:${withDependencies.id}:attempt:${withDependencies.attemptCount + 1}`,
            input.runId,
            input.queueName ?? "lattice.research",
            {
              taskId: withDependencies.id,
              taskFingerprint: withDependencies.taskFingerprint,
              runEpoch: withDependencies.runEpoch,
            },
            new Date(0),
          );
        }
      }
      await client.query("COMMIT");
      return { outcome: "scheduled", tasks: materialized };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getResearchTask(taskId: string): Promise<DurableResearchTask | undefined> {
    const client = await this.pool.connect();
    try {
      return await loadTask(client, taskId);
    } finally {
      client.release();
    }
  }

  async claimResearchTask(input: {
    taskId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ClaimResearchTaskResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runId = await taskRunId(client, input.taskId);
      if (!runId) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const run = await runState(client, runId, true);
      const task = await loadTask(client, input.taskId, true);
      if (!task) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      if (task.status === "SUCCEEDED") {
        await client.query("COMMIT");
        return { outcome: "completed", result: task.acceptedResult };
      }
      if (!run || isTerminal(run.status) || run.version !== task.runEpoch) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      if (!(await dependenciesSatisfied(client, task.id))) {
        await client.query("ROLLBACK");
        return { outcome: "busy" };
      }
      if (task.status === "RUNNING" && task.leaseExpiresAt && new Date(task.leaseExpiresAt) > input.now) {
        await client.query("ROLLBACK");
        return { outcome: "busy" };
      }
      if (task.status === "RUNNING" && task.currentAttempt !== null) {
        await client.query(
          `UPDATE run_task_attempts
           SET status='STALE',completed_at=$1
           WHERE task_id=$2 AND attempt_number=$3 AND status='RUNNING'`,
          [input.now, task.id, task.currentAttempt],
        );
      }
      if (task.attemptCount >= task.maxAttempts) {
        await client.query(
          "UPDATE run_tasks SET status='FAILED',lease_owner=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1",
          [task.id, input.now],
        );
        await client.query("COMMIT");
        return { outcome: "exhausted" };
      }

      const attemptNumber = task.attemptCount + 1;
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
      const attemptResult = await client.query<AttemptRow>(
        `INSERT INTO run_task_attempts(
           run_id,task_id,attempt_number,worker_id,status,lease_expires_at,started_at
         ) VALUES ($1,$2,$3,$4,'RUNNING',$5,$6)
         RETURNING task_id,attempt_number,worker_id,status,lease_expires_at,result_json,error_text,started_at,completed_at`,
        [task.runId, task.id, attemptNumber, input.workerId, leaseExpiresAt, input.now],
      );
      await client.query(
        `UPDATE run_tasks
         SET status='RUNNING',attempt_count=$2,current_attempt=$2,lease_owner=$3,lease_expires_at=$4,updated_at=$5
         WHERE id=$1`,
        [task.id, attemptNumber, input.workerId, leaseExpiresAt, input.now],
      );
      const claimed = await loadTask(client, task.id);
      if (!claimed) throw new Error("Claimed research task could not be reloaded.");
      await client.query("COMMIT");
      return { outcome: "claimed", task: claimed, attempt: attemptFromRow(attemptResult.rows[0]!) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeResearchTask(input: {
    taskId: string;
    workerId: string;
    attemptNumber: number;
    result: unknown;
    now: Date;
  }): Promise<CompleteResearchTaskResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runId = await taskRunId(client, input.taskId);
      if (!runId) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const run = await runState(client, runId, true);
      const task = await loadTask(client, input.taskId, true);
      if (!task) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      if (task.status === "SUCCEEDED") {
        await client.query("COMMIT");
        return { outcome: "existing", result: task.acceptedResult };
      }
      const leaseValid = task.leaseExpiresAt !== null && new Date(task.leaseExpiresAt) > input.now;
      if (
        !run || isTerminal(run.status) || run.version !== task.runEpoch
        || task.status !== "RUNNING" || task.currentAttempt !== input.attemptNumber
        || task.leaseOwner !== input.workerId || !leaseValid
      ) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const attempt = await client.query<AttemptRow>(
        `SELECT task_id,attempt_number,worker_id,status,lease_expires_at,result_json,error_text,started_at,completed_at
         FROM run_task_attempts WHERE task_id=$1 AND attempt_number=$2 FOR UPDATE`,
        [task.id, input.attemptNumber],
      );
      if (!attempt.rows[0] || attempt.rows[0].status !== "RUNNING" || attempt.rows[0].worker_id !== input.workerId) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }

      await client.query(
        `UPDATE run_tasks
         SET status='SUCCEEDED',accepted_result_json=$2::jsonb,lease_owner=NULL,lease_expires_at=NULL,updated_at=$3
         WHERE id=$1`,
        [task.id, JSON.stringify(input.result), input.now],
      );
      await client.query(
        `UPDATE run_task_attempts
         SET status='SUCCEEDED',result_json=$3::jsonb,completed_at=$4
         WHERE task_id=$1 AND attempt_number=$2`,
        [task.id, input.attemptNumber, JSON.stringify(input.result), input.now],
      );
      await insertOutbox(
        client,
        `orchestrator:research-task:${task.id}:accepted`,
        task.runId,
        "lattice.orchestrate",
        { runId: task.runId, taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
        input.now,
      );
      await enqueueReadyDependents(client, task, input.now);
      await client.query("COMMIT");
      return { outcome: "accepted", result: structuredClone(input.result) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failResearchTask(input: {
    taskId: string;
    workerId: string;
    attemptNumber: number;
    error: string;
    now: Date;
    retryAt?: Date;
  }): Promise<FailResearchTaskResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runId = await taskRunId(client, input.taskId);
      if (!runId) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const run = await runState(client, runId, true);
      const task = await loadTask(client, input.taskId, true);
      if (!task) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      if (
        !run || isTerminal(run.status) || run.version !== task.runEpoch
        || task.status !== "RUNNING" || task.currentAttempt !== input.attemptNumber
        || task.leaseOwner !== input.workerId
      ) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const attempt = await client.query<AttemptRow>(
        `SELECT task_id,attempt_number,worker_id,status,lease_expires_at,result_json,error_text,started_at,completed_at
         FROM run_task_attempts WHERE task_id=$1 AND attempt_number=$2 FOR UPDATE`,
        [task.id, input.attemptNumber],
      );
      if (!attempt.rows[0] || attempt.rows[0].status !== "RUNNING" || attempt.rows[0].worker_id !== input.workerId) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      await client.query(
        `UPDATE run_task_attempts
         SET status='FAILED',error_text=$3,completed_at=$4
         WHERE task_id=$1 AND attempt_number=$2`,
        [task.id, input.attemptNumber, input.error, input.now],
      );
      if (task.attemptCount >= task.maxAttempts) {
        await client.query(
          `UPDATE run_tasks
           SET status='FAILED',lease_owner=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1`,
          [task.id, input.now],
        );
        await insertOutbox(
          client,
          `orchestrator:research-task:${task.id}:exhausted`,
          task.runId,
          "lattice.orchestrate",
          { runId: task.runId, taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
          input.now,
        );
        await client.query("COMMIT");
        return { outcome: "exhausted" };
      }
      await client.query(
        `UPDATE run_tasks
         SET status='PENDING',lease_owner=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1`,
        [task.id, input.now],
      );
      await insertOutbox(
        client,
        `research-task:${task.id}:attempt:${task.attemptCount + 1}`,
        task.runId,
        "lattice.research",
        { taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
        input.retryAt ?? input.now,
      );
      await client.query("COMMIT");
      return { outcome: "retry_scheduled" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDispatches(input: {
    queueName: string;
    workerId: string;
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<DispatchEnvelope[]> {
    if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error("Dispatch claim limit must be positive.");
    if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0) throw new Error("Dispatch leaseMs must be positive.");
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id
         FROM dispatch_outbox
         WHERE queue_name=$1
           AND dispatched_at IS NULL
           AND available_at <= $2
           AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
         ORDER BY available_at,id
         FOR UPDATE SKIP LOCKED
         LIMIT $3
       )
       UPDATE dispatch_outbox item
       SET lease_owner=$4,
           lease_expires_at=$2 + ($5::double precision * interval '1 millisecond'),
           delivery_attempts=delivery_attempts+1
       FROM candidates
       WHERE item.id=candidates.id
       RETURNING item.id,item.logical_key,item.run_id,item.queue_name,item.payload,item.available_at,
                 item.lease_owner,item.lease_expires_at,item.delivery_attempts,item.dispatched_at`,
      [input.queueName, input.now, input.limit, input.workerId, input.leaseMs],
    );
    return result.rows.map(outboxFromRow);
  }

  async acknowledgeDispatch(input: { id: number; workerId: string; now: Date }): Promise<DispatchMutationResult> {
    const result = await this.pool.query(
      `UPDATE dispatch_outbox
       SET dispatched_at=$3,lease_owner=NULL,lease_expires_at=NULL
       WHERE id=$1 AND dispatched_at IS NULL AND lease_owner=$2`,
      [input.id, input.workerId, input.now],
    );
    return (result.rowCount ?? 0) === 1 ? { outcome: "updated" } : { outcome: "stale" };
  }

  async releaseDispatch(input: { id: number; workerId: string; availableAt: Date }): Promise<DispatchMutationResult> {
    const result = await this.pool.query(
      `UPDATE dispatch_outbox
       SET lease_owner=NULL,lease_expires_at=NULL,available_at=$3
       WHERE id=$1 AND dispatched_at IS NULL AND lease_owner=$2`,
      [input.id, input.workerId, input.availableAt],
    );
    return (result.rowCount ?? 0) === 1 ? { outcome: "updated" } : { outcome: "stale" };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
