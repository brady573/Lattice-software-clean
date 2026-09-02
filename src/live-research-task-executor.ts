import type { DurableResearchTask } from "./orchestration-store.js";
import type {
  ResearchTaskExecutionContext,
  ResearchTaskExecutor,
} from "./research-worker.js";
import {
  assertLiveResearchBindingStillActive,
  resolveLiveResearchBinding,
  type LiveResearchBinding,
  type LiveResearchBindingStores,
} from "./live-research-binding.js";

export interface LiveV36ResearchRequest {
  readonly id: string;
  readonly runId: string;
  readonly claimId: string;
  readonly parentRequestId: string | null;
  readonly purpose: string;
  readonly query: string;
  readonly serialRound: number;
}

export interface ParsedLiveV36ResearchTask {
  readonly checkpointHash: string;
  readonly request: LiveV36ResearchRequest;
}

export interface LiveResearchOperationContext {
  readonly task: DurableResearchTask;
  readonly binding: LiveResearchBinding;
  readonly checkpointHash: string;
  readonly request: LiveV36ResearchRequest;
}

/**
 * One already-qualified operational research capability. This seam has no V36
 * evidence-admission or truth authority; it only returns an opaque operational
 * payload for the existing durable Research Worker to persist.
 */
export interface LiveResearchOperation {
  execute(context: LiveResearchOperationContext): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function parseLiveV36ResearchTask(task: DurableResearchTask): ParsedLiveV36ResearchTask {
  if (task.taskType !== "RESEARCH") throw new Error("Live research executor accepts RESEARCH tasks only.");
  const root = record(task.input);
  if (root?.kind !== "V36_RESEARCH_REQUEST") {
    throw new Error("Live research executor accepts V36_RESEARCH_REQUEST tasks only.");
  }
  const checkpointHash = nonEmptyString(root.checkpointHash, "V36 checkpoint hash", 256);
  if (!task.contextVersionIds.includes(`v36-checkpoint:${checkpointHash}`)) {
    throw new Error("Live research task checkpoint binding is missing from durable context identity.");
  }

  const rawRequest = record(root.request);
  if (!rawRequest) throw new Error("V36 research request is invalid.");
  const runId = nonEmptyString(rawRequest.runId, "V36 research request runId", 256);
  if (runId !== task.runId) throw new Error("V36 research request crossed durable Run scope.");
  const parentRequestId = rawRequest.parentRequestId;
  if (parentRequestId !== null && typeof parentRequestId !== "string") {
    throw new Error("V36 research request parentRequestId is invalid.");
  }
  const serialRound = rawRequest.serialRound;
  if (!Number.isSafeInteger(serialRound) || (serialRound as number) < 1) {
    throw new Error("V36 research request serialRound is invalid.");
  }

  return Object.freeze({
    checkpointHash,
    request: Object.freeze({
      id: nonEmptyString(rawRequest.id, "V36 research request id", 256),
      runId,
      claimId: nonEmptyString(rawRequest.claimId, "V36 research request claimId", 256),
      parentRequestId: parentRequestId as string | null,
      purpose: nonEmptyString(rawRequest.purpose, "V36 research request purpose", 256),
      query: nonEmptyString(rawRequest.query, "V36 research request query", 64 * 1024),
      serialRound: serialRound as number,
    }),
  });
}

/**
 * Durable M9-5 execution seam. Product-owned binding is derived before the
 * external operation and rechecked after it. Only then may the existing
 * Research Worker persist the opaque operational result.
 */
export class BoundLiveResearchTaskExecutor implements ResearchTaskExecutor {
  constructor(
    private readonly stores: LiveResearchBindingStores,
    private readonly operation: LiveResearchOperation,
  ) {}

  async execute(context: ResearchTaskExecutionContext): Promise<unknown> {
    const parsed = parseLiveV36ResearchTask(context.task);
    const binding = await resolveLiveResearchBinding(this.stores, context.task);
    const result = await this.operation.execute({
      task: context.task,
      binding,
      checkpointHash: parsed.checkpointHash,
      request: parsed.request,
    });
    await assertLiveResearchBindingStillActive(this.stores, binding);
    return result;
  }
}
