import { createHash, randomUUID } from "node:crypto";
import type { RunStatus } from "./domain.js";
import type { RunStore } from "./run-store.js";

export type ResearchTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type ResearchAttemptStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "STALE";

export interface ResearchTaskDefinition {
  taskFingerprint: string;
  planVersion: number;
  normalizedInputs: unknown;
  contextVersionIds: string[];
  dependsOn: string[];
  maxAttempts: number;
}

export interface ResearchTaskIdentityInput {
  runId: string;
  planVersion: number;
  normalizedInputs: unknown;
  contextVersionIds?: readonly string[];
}

export interface DurableResearchTask {
  id: string;
  runId: string;
  taskFingerprint: string;
  planVersion: number;
  taskType: "RESEARCH";
  input: unknown;
  contextVersionIds: string[];
  dependsOn: string[];
  runEpoch: number;
  status: ResearchTaskStatus;
  maxAttempts: number;
  attemptCount: number;
  currentAttempt: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  acceptedResult: unknown | null;
}

export interface DurableResearchAttempt {
  taskId: string;
  attemptNumber: number;
  workerId: string;
  status: ResearchAttemptStatus;
  leaseExpiresAt: string;
  result: unknown | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface DispatchEnvelope {
  id: number;
  logicalKey: string;
  runId: string;
  queueName: string;
  payload: unknown;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  deliveryAttempts: number;
  dispatchedAt: string | null;
}

export interface ScheduleResearchGraphInput {
  runId: string;
  expectedStatus: RunStatus;
  expectedVersion: number;
  tasks: ResearchTaskDefinition[];
  queueName?: string;
}

export type ScheduleResearchGraphResult =
  | { outcome: "scheduled"; tasks: DurableResearchTask[] }
  | { outcome: "stale" };

export type ClaimResearchTaskResult =
  | { outcome: "claimed"; task: DurableResearchTask; attempt: DurableResearchAttempt }
  | { outcome: "busy" }
  | { outcome: "completed"; result: unknown }
  | { outcome: "exhausted" }
  | { outcome: "stale" };

export type CompleteResearchTaskResult =
  | { outcome: "accepted"; result: unknown }
  | { outcome: "existing"; result: unknown }
  | { outcome: "stale" };

export type FailResearchTaskResult =
  | { outcome: "retry_scheduled" }
  | { outcome: "exhausted" }
  | { outcome: "stale" };

export type DispatchMutationResult = { outcome: "updated" } | { outcome: "stale" };

export interface DurableOrchestrationStore {
  scheduleResearchGraph(input: ScheduleResearchGraphInput): Promise<ScheduleResearchGraphResult>;
  getResearchTask(taskId: string): Promise<DurableResearchTask | undefined>;
  claimResearchTask(input: {
    taskId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ClaimResearchTaskResult>;
  completeResearchTask(input: {
    taskId: string;
    workerId: string;
    attemptNumber: number;
    result: unknown;
    now: Date;
  }): Promise<CompleteResearchTaskResult>;
  failResearchTask(input: {
    taskId: string;
    workerId: string;
    attemptNumber: number;
    error: string;
    now: Date;
    retryAt?: Date;
  }): Promise<FailResearchTaskResult>;
  claimDispatches(input: {
    queueName: string;
    workerId: string;
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<DispatchEnvelope[]>;
  acknowledgeDispatch(input: { id: number; workerId: string; now: Date }): Promise<DispatchMutationResult>;
  releaseDispatch(input: { id: number; workerId: string; availableAt: Date }): Promise<DispatchMutationResult>;
  close(): Promise<void>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function createResearchTaskFingerprint(input: ResearchTaskIdentityInput): string {
  if (input.runId.trim().length === 0) throw new Error("Research task runId must not be blank.");
  if (!Number.isInteger(input.planVersion) || input.planVersion <= 0) {
    throw new Error("Research task planVersion must be a positive integer.");
  }
  const contextVersionIds = [...(input.contextVersionIds ?? [])].sort();
  return createHash("sha256")
    .update(stableJson({
      runId: input.runId,
      planVersion: input.planVersion,
      taskType: "RESEARCH",
      normalizedInputs: input.normalizedInputs,
      contextVersionIds,
    }))
    .digest("hex");
}

export function defineResearchTask(
  input: ResearchTaskIdentityInput & { dependsOn?: readonly string[]; maxAttempts?: number },
): ResearchTaskDefinition {
  const maxAttempts = input.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("Research task maxAttempts must be a positive integer.");
  }
  return {
    taskFingerprint: createResearchTaskFingerprint(input),
    planVersion: input.planVersion,
    normalizedInputs: structuredClone(input.normalizedInputs),
    contextVersionIds: [...(input.contextVersionIds ?? [])].sort(),
    dependsOn: [...(input.dependsOn ?? [])],
    maxAttempts,
  };
}

export function assertResearchTaskGraph(tasks: readonly ResearchTaskDefinition[]): void {
  const byFingerprint = new Map<string, ResearchTaskDefinition>();
  for (const task of tasks) {
    if (byFingerprint.has(task.taskFingerprint)) {
      throw new Error(`Duplicate research task fingerprint: ${task.taskFingerprint}`);
    }
    byFingerprint.set(task.taskFingerprint, task);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.taskFingerprint) throw new Error("Research task cannot depend on itself.");
      if (!byFingerprint.has(dependency)) {
        throw new Error(`Unknown research task dependency: ${dependency}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (fingerprint: string): void => {
    if (visited.has(fingerprint)) return;
    if (visiting.has(fingerprint)) throw new Error("Research task graph contains a directed cycle.");
    visiting.add(fingerprint);
    for (const dependency of byFingerprint.get(fingerprint)?.dependsOn ?? []) visit(dependency);
    visiting.delete(fingerprint);
    visited.add(fingerprint);
  };
  for (const fingerprint of byFingerprint.keys()) visit(fingerprint);
}

function isTerminal(status: RunStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "FAILED";
}

function cloneTask(task: DurableResearchTask): DurableResearchTask {
  return structuredClone(task);
}

export class MemoryOrchestrationStore implements DurableOrchestrationStore {
  private readonly tasks = new Map<string, DurableResearchTask>();
  private readonly taskByFingerprint = new Map<string, string>();
  private readonly attempts = new Map<string, DurableResearchAttempt[]>();
  private readonly outbox = new Map<number, DispatchEnvelope>();
  private readonly outboxByLogicalKey = new Map<string, number>();
  private nextOutboxId = 1;

  constructor(private readonly runStore: RunStore) {}

  private insertOutbox(
    logicalKey: string,
    runId: string,
    queueName: string,
    payload: unknown,
    availableAt: Date,
  ): void {
    if (this.outboxByLogicalKey.has(logicalKey)) return;
    const id = this.nextOutboxId++;
    this.outboxByLogicalKey.set(logicalKey, id);
    this.outbox.set(id, {
      id,
      logicalKey,
      runId,
      queueName,
      payload: structuredClone(payload),
      availableAt: availableAt.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      deliveryAttempts: 0,
      dispatchedAt: null,
    });
  }

  private taskReady(task: DurableResearchTask): boolean {
    return task.dependsOn.every((fingerprint) => {
      const dependencyId = this.taskByFingerprint.get(`${task.runId}\u0000${fingerprint}`);
      return dependencyId ? this.tasks.get(dependencyId)?.status === "SUCCEEDED" : false;
    });
  }

  private enqueueReadyTask(task: DurableResearchTask, availableAt = new Date(0)): void {
    if (task.status !== "PENDING" || !this.taskReady(task)) return;
    this.insertOutbox(
      `research-task:${task.id}:attempt:${task.attemptCount + 1}`,
      task.runId,
      "lattice.research",
      { taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
      availableAt,
    );
  }

  private enqueueDependents(task: DurableResearchTask, now: Date): void {
    for (const candidate of this.tasks.values()) {
      if (candidate.runId === task.runId && candidate.dependsOn.includes(task.taskFingerprint)) {
        this.enqueueReadyTask(candidate, now);
      }
    }
  }

  async scheduleResearchGraph(input: ScheduleResearchGraphInput): Promise<ScheduleResearchGraphResult> {
    assertResearchTaskGraph(input.tasks);
    const run = await this.runStore.get(input.runId);
    if (!run || run.status !== input.expectedStatus || run.version !== input.expectedVersion || isTerminal(run.status)) {
      return { outcome: "stale" };
    }

    const created: DurableResearchTask[] = [];
    for (const definition of input.tasks) {
      const fingerprintKey = `${input.runId}\u0000${definition.taskFingerprint}`;
      const existingId = this.taskByFingerprint.get(fingerprintKey);
      if (existingId) {
        const existing = this.tasks.get(existingId);
        if (!existing) throw new Error("Research task fingerprint index is inconsistent.");
        if (
          existing.planVersion !== definition.planVersion
          || stableJson(existing.input) !== stableJson(definition.normalizedInputs)
          || stableJson(existing.contextVersionIds) !== stableJson([...definition.contextVersionIds].sort())
          || stableJson(existing.dependsOn) !== stableJson(definition.dependsOn)
          || existing.maxAttempts !== definition.maxAttempts
          || existing.runEpoch !== input.expectedVersion
        ) {
          throw new Error(`Research task fingerprint ${definition.taskFingerprint} collided with different task state.`);
        }
        created.push(cloneTask(existing));
        continue;
      }
      const task: DurableResearchTask = {
        id: randomUUID(),
        runId: input.runId,
        taskFingerprint: definition.taskFingerprint,
        planVersion: definition.planVersion,
        taskType: "RESEARCH",
        input: structuredClone(definition.normalizedInputs),
        contextVersionIds: [...definition.contextVersionIds].sort(),
        dependsOn: [...definition.dependsOn],
        runEpoch: input.expectedVersion,
        status: "PENDING",
        maxAttempts: definition.maxAttempts,
        attemptCount: 0,
        currentAttempt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        acceptedResult: null,
      };
      this.tasks.set(task.id, task);
      this.taskByFingerprint.set(fingerprintKey, task.id);
      created.push(cloneTask(task));
    }
    for (const task of created) {
      const current = this.tasks.get(task.id);
      if (current) this.enqueueReadyTask(current, new Date(0));
    }
    return { outcome: "scheduled", tasks: created };
  }

  async getResearchTask(taskId: string): Promise<DurableResearchTask | undefined> {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : undefined;
  }

  async claimResearchTask(input: {
    taskId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ClaimResearchTaskResult> {
    const task = this.tasks.get(input.taskId);
    if (!task) return { outcome: "stale" };
    if (task.status === "SUCCEEDED") return { outcome: "completed", result: structuredClone(task.acceptedResult) };
    const run = await this.runStore.get(task.runId);
    if (!run || isTerminal(run.status) || run.version !== task.runEpoch) return { outcome: "stale" };
    if (!this.taskReady(task)) return { outcome: "busy" };

    const leaseExpiresAt = task.leaseExpiresAt ? new Date(task.leaseExpiresAt) : null;
    if (task.status === "RUNNING" && leaseExpiresAt && leaseExpiresAt > input.now) return { outcome: "busy" };
    if (task.status === "RUNNING") {
      const prior = this.attempts.get(task.id)?.find((attempt) => attempt.attemptNumber === task.currentAttempt);
      if (prior && prior.status === "RUNNING") {
        prior.status = "STALE";
        prior.completedAt = input.now.toISOString();
      }
    }
    if (task.attemptCount >= task.maxAttempts) {
      task.status = "FAILED";
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      return { outcome: "exhausted" };
    }

    const attemptNumber = task.attemptCount + 1;
    const attempt: DurableResearchAttempt = {
      taskId: task.id,
      attemptNumber,
      workerId: input.workerId,
      status: "RUNNING",
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString(),
      result: null,
      error: null,
      startedAt: input.now.toISOString(),
      completedAt: null,
    };
    const attempts = this.attempts.get(task.id) ?? [];
    attempts.push(attempt);
    this.attempts.set(task.id, attempts);
    task.status = "RUNNING";
    task.attemptCount = attemptNumber;
    task.currentAttempt = attemptNumber;
    task.leaseOwner = input.workerId;
    task.leaseExpiresAt = attempt.leaseExpiresAt;
    return { outcome: "claimed", task: cloneTask(task), attempt: structuredClone(attempt) };
  }

  async completeResearchTask(input: {
    taskId: string;
    workerId: string;
    attemptNumber: number;
    result: unknown;
    now: Date;
  }): Promise<CompleteResearchTaskResult> {
    const task = this.tasks.get(input.taskId);
    if (!task) return { outcome: "stale" };
    if (task.status === "SUCCEEDED") return { outcome: "existing", result: structuredClone(task.acceptedResult) };
    const run = await this.runStore.get(task.runId);
    const attempt = this.attempts.get(task.id)?.find((item) => item.attemptNumber === input.attemptNumber);
    const leaseValid = task.leaseExpiresAt !== null && new Date(task.leaseExpiresAt) > input.now;
    if (
      !run || isTerminal(run.status) || run.version !== task.runEpoch
      || task.status !== "RUNNING" || task.currentAttempt !== input.attemptNumber
      || task.leaseOwner !== input.workerId || !leaseValid || !attempt || attempt.status !== "RUNNING"
    ) {
      return { outcome: "stale" };
    }

    const accepted = structuredClone(input.result);
    task.status = "SUCCEEDED";
    task.acceptedResult = accepted;
    task.leaseOwner = null;
    task.leaseExpiresAt = null;
    attempt.status = "SUCCEEDED";
    attempt.result = structuredClone(input.result);
    attempt.completedAt = input.now.toISOString();
    this.insertOutbox(
      `orchestrator:research-task:${task.id}:accepted`,
      task.runId,
      "lattice.orchestrate",
      { runId: task.runId, taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
      input.now,
    );
    this.enqueueDependents(task, input.now);
    return { outcome: "accepted", result: accepted };
  }

  async failResearchTask(input: {
    taskId: string;
    workerId: string;
    attemptNumber: number;
    error: string;
    now: Date;
    retryAt?: Date;
  }): Promise<FailResearchTaskResult> {
    const task = this.tasks.get(input.taskId);
    if (!task) return { outcome: "stale" };
    const run = await this.runStore.get(task.runId);
    const attempt = this.attempts.get(task.id)?.find((item) => item.attemptNumber === input.attemptNumber);
    if (
      !run || isTerminal(run.status) || run.version !== task.runEpoch
      || task.status !== "RUNNING" || task.currentAttempt !== input.attemptNumber
      || task.leaseOwner !== input.workerId || !attempt || attempt.status !== "RUNNING"
    ) {
      return { outcome: "stale" };
    }
    attempt.status = "FAILED";
    attempt.error = input.error;
    attempt.completedAt = input.now.toISOString();
    task.leaseOwner = null;
    task.leaseExpiresAt = null;
    if (task.attemptCount >= task.maxAttempts) {
      task.status = "FAILED";
      this.insertOutbox(
        `orchestrator:research-task:${task.id}:exhausted`,
        task.runId,
        "lattice.orchestrate",
        { runId: task.runId, taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
        input.now,
      );
      return { outcome: "exhausted" };
    }
    task.status = "PENDING";
    this.insertOutbox(
      `research-task:${task.id}:attempt:${task.attemptCount + 1}`,
      task.runId,
      "lattice.research",
      { taskId: task.id, taskFingerprint: task.taskFingerprint, runEpoch: task.runEpoch },
      input.retryAt ?? input.now,
    );
    return { outcome: "retry_scheduled" };
  }

  async claimDispatches(input: {
    queueName: string;
    workerId: string;
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<DispatchEnvelope[]> {
    const eligible = [...this.outbox.values()]
      .filter((item) =>
        item.queueName === input.queueName
        && item.dispatchedAt === null
        && new Date(item.availableAt) <= input.now
        && (item.leaseExpiresAt === null || new Date(item.leaseExpiresAt) <= input.now),
      )
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.id - right.id)
      .slice(0, input.limit);
    for (const item of eligible) {
      item.leaseOwner = input.workerId;
      item.leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      item.deliveryAttempts += 1;
    }
    return eligible.map((item) => structuredClone(item));
  }

  async acknowledgeDispatch(input: { id: number; workerId: string; now: Date }): Promise<DispatchMutationResult> {
    const item = this.outbox.get(input.id);
    if (!item || item.dispatchedAt !== null || item.leaseOwner !== input.workerId) return { outcome: "stale" };
    item.dispatchedAt = input.now.toISOString();
    item.leaseOwner = null;
    item.leaseExpiresAt = null;
    return { outcome: "updated" };
  }

  async releaseDispatch(input: { id: number; workerId: string; availableAt: Date }): Promise<DispatchMutationResult> {
    const item = this.outbox.get(input.id);
    if (!item || item.dispatchedAt !== null || item.leaseOwner !== input.workerId) return { outcome: "stale" };
    item.leaseOwner = null;
    item.leaseExpiresAt = null;
    item.availableAt = input.availableAt.toISOString();
    return { outcome: "updated" };
  }

  async close(): Promise<void> {
    this.tasks.clear();
    this.taskByFingerprint.clear();
    this.attempts.clear();
    this.outbox.clear();
    this.outboxByLogicalKey.clear();
  }
}
