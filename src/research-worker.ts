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

function parseResearchDispatchPayload(payload: unknown): ResearchDispatchPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (
    typeof record.taskId !== "string"
    || record.taskId.trim().length === 0
    || typeof record.taskFingerprint !== "string"
    || record.taskFingerprint.trim().length === 0
    || !Number.isSafeInteger(record.runEpoch)
    || (record.runEpoch as number) < 0
  ) {
    return null;
  }
  return {
    taskId: record.taskId,
    taskFingerprint: record.taskFingerprint,
    runEpoch: record.runEpoch as number,
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
  availableAt: Date,
  runId: string,
  taskId: string | null,
): Promise<ResearchDispatchOutcome> {
  const result = await store.releaseDispatch({ id: dispatchId, workerId, availableAt });
  return {
    dispatchId,
    runId,
    taskId,
    outcome: result.outcome === "updated" ? "released" : "stale",
  };
}

/**
 * Consume at-least-once `lattice.research` dispatches while preserving the
 * durable task/attempt contract as the operational source of truth. Executor
 * output is persisted only as an immutable task result; V36 admission and
 * epistemic continuation are intentionally outside this worker.
 */
export async function processResearchDispatches(
  input: ProcessResearchDispatchesInput,
): Promise<ResearchDispatchOutcome[]> {
  const leaseMs = input.leaseMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 1_000;
  const limit = input.limit ?? 10;
  const clock = input.clock ?? (() => new Date());
  const dispatches = await input.orchestrationStore.claimDispatches({
    queueName: "lattice.research",
    workerId: input.workerId,
    now: input.now,
    leaseMs,
    limit,
  });

  const outcomes: ResearchDispatchOutcome[] = [];
  for (const dispatch of dispatches) {
    const payload = parseResearchDispatchPayload(dispatch.payload);
    if (!payload) {
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        input.now,
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
        input.now,
        "discarded",
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }

    const claim = await input.orchestrationStore.claimResearchTask({
      taskId: payload.taskId,
      workerId: input.workerId,
      now: input.now,
      leaseMs,
    });

    if (claim.outcome === "busy") {
      outcomes.push(await release(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        new Date(input.now.getTime() + retryDelayMs),
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
        input.now,
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
        input.now,
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
        input.now,
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
        outcomes.push(await release(
          input.orchestrationStore,
          dispatch.id,
          input.workerId,
          new Date(failureTime.getTime() + retryDelayMs),
          dispatch.runId,
          payload.taskId,
        ));
        continue;
      }
      outcomes.push(await acknowledge(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        failureTime,
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
      outcomes.push(await release(
        input.orchestrationStore,
        dispatch.id,
        input.workerId,
        new Date(completionTime.getTime() + retryDelayMs),
        dispatch.runId,
        payload.taskId,
      ));
      continue;
    }

    outcomes.push(await acknowledge(
      input.orchestrationStore,
      dispatch.id,
      input.workerId,
      completionTime,
      completed.outcome === "accepted" ? "completed" : "existing",
      dispatch.runId,
      payload.taskId,
    ));
  }

  return outcomes;
}
