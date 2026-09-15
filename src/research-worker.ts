import type {
  DurableOrchestrationStore,
  DurableResearchTask,
} from "./orchestration-store.js";

export interface ResearchTaskExecutionContext {
  task: DurableResearchTask;
}

/**
 * Operational execution dependency for one already-authorized durable research
 * task. Implementations may acquire observations, but this contract has no
 * authority to admit evidence, judge sufficiency, or change V36 truth state.
 */
export interface ResearchTaskExecutor {
  execute(context: ResearchTaskExecutionContext): Promise<unknown>;
}

export interface ProcessResearchDispatchesInput {
  orchestrationStore: DurableOrchestrationStore;
  executor: ResearchTaskExecutor;
  workerId: string;
  now: Date;
  leaseMs?: number;
  retryDelayMs?: number;
  limit?: number;
  clock?: () => Date;
}

export interface ResearchDispatchOutcome {
  dispatchId: number;
  runId: string;
  taskId: string | null;
  outcome:
    | "completed"
    | "existing"
    | "retry_scheduled"
    | "exhausted"
    | "released"
    | "discarded"
    | "stale";
}

interface ResearchDispatchPayload {
  taskId: string;
  taskFingerprint: string;
  runEpoch: number;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseResearchDispatchPayload(payload: unknown): ResearchDispatchPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const runEpoch = record.runEpoch;
  if (
    typeof record.taskId !== "string"
    || record.taskId.trim().length === 0
    || typeof record.taskFingerprint !== "string"
    || record.taskFingerprint.trim().length === 0
    || !isSafeInteger(runEpoch)
    || runEpoch < 0
  ) {
    return null;
  }
  return {
    taskId: record.taskId,
    taskFingerprint: record.taskFingerprint,
    runEpoch,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

async function acknowledge(
  store: DurableOrchestrationStore,
  dispatchId: number,
  workerId: string,
  now: Date,
  desired: ResearchDispatchOutcome["outcome"],
  runId: string,
  taskId: string | null,
): Promise<ResearchDispatchOutcome> {
  const result = await store.acknowledgeDispatch({ id: dispatchId, workerId, now });
  return {
    dispatchId,
    runId,
    taskId,
    outcome: result.outcome === "updated" ? desired : "stale",
  };
}

async function release(
  store: DurableOrchestrationStore,
  dispatchId: number,
  workerId: string,
  now: Date,
  availableAt: Date,
  runId: string,
  taskId: string | null,
): Promise<ResearchDispatchOutcome> {
  const result = await store.releaseDispatch({ id: dispatchId, workerId, now, availableAt });
  return {
    dispatchId,
    runId,
    taskId,
    outcome: result.outcome === "updated" ? "released" : "stale",
  };
}

/**
 * Consume at-least-once `lattice.research` dispatches while preserving the
 * durable task/attempt contract as the operational source of truth. Work is
 * claimed immediately before local execution, and every task/dispatch
 * mutation uses fresh time rather than a poll-start timestamp.
 */
export async function processResearchDispatches(
  input: ProcessResearchDispatchesInput,
): Promise<ResearchDispatchOutcome[]> {
  const leaseMs = input.leaseMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 1_000;
  const limit = input.limit ?? 10;
  const clock = input.clock ?? (() => new Date(Math.max(input.now.getTime(), Date.now())));
  const outcomes: ResearchDispatchOutcome[] = [];

  for (let processed = 0; processed < limit; processed += 1) {
    const claimTime = clock();
    const dispatch = (await input.orchestrationStore.claimDispatches({
      queueName: "lattice.research",
      workerId: input.workerId,
      now: claimTime,
      leaseMs,
      limit: 1,
    }))[0];
    if (!dispatch) break;

    const payload = parseResearchDispatchPayload(dispatch.payload);
    if (!payload) {
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        clock(),
        "discarded",
        dispatch.runId,
        null,
      ));
      continue;
    }

    const persisted = await input.orchestrationStore.getResearchTask(payload.taskId);
    if (
      !persisted
      || persisted.runId !== dispatch.runId
      || persisted.taskFingerprint !== payload.taskFingerprint
      || persisted.runEpoch !== payload.runEpoch
    ) {
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        clock(),
        "discarded",
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }

    const taskClaimTime = clock();
    const claim = await input.orchestrationStore.claimResearchTask({
      taskId: payload.taskId,
      workerId: input.workerId,
      now: taskClaimTime,
      leaseMs,
    });

    if (claim.outcome === "busy") {
      const releaseTime = clock();
      outcomes.push(await release(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        releaseTime,
        new Date(releaseTime.getTime() + retryDelayMs),
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }
    if (claim.outcome === "completed") {
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        clock(),
        "existing",
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }
    if (claim.outcome === "exhausted") {
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        clock(),
        "exhausted",
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }
    if (claim.outcome === "stale") {
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        clock(),
        "discarded",
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }

    let result: unknown;
    try {
      result = await input.executor.execute({ task: claim.task });
    } catch (error) {
      const failureTime = clock();
      const failed = await input.orchestrationStore.failResearchTask({
        taskId: claim.task.id,
        workerId: input.workerId,
        attemptNumber: claim.attempt.attemptNumber,
        error: errorMessage(error),
        now: failureTime,
        retryAt: new Date(failureTime.getTime() + retryDelayMs),
      });
      if (failed.outcome === "stale") {
        const releaseTime = clock();
        outcomes.push(await release(
          input.orchestrationStore,
          dispatch.id,
          input.workerId,
          releaseTime,
          new Date(releaseTime.getTime() + retryDelayMs),
          dispatch.runId,
          payload.taskId,
        ));
        continue;
      }
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        clock(),
        failed.outcome,
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }

    const completionTime = clock();
    const completed = await input.orchestrationStore.completeResearchTask({
      taskId: claim.task.id,
      workerId: input.workerId,
      attemptNumber: claim.attempt.attemptNumber,
      result,
      now: completionTime,
    });
    if (completed.outcome === "stale") {
      const releaseTime = clock();
      outcomes.push(await release(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        releaseTime,
        new Date(releaseTime.getTime() + retryDelayMs),
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }

    outcomes.push(await acknowledge(
      input.orchestrationStore,
      dispatch.id,
      input.workerId,
      clock(),
      completed.outcome === "accepted" ? "completed" : "existing",
      dispatch.runId,
      payload.taskId,
    ));
  }

  return outcomes;
}
