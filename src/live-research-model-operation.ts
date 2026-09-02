import {
  executeCapabilityProposal,
  type CapabilityExecutor,
  type CapabilityGrant,
  type CapabilityStateGuard,
  type PriorCapabilityOperation,
} from "./capability-execution-policy.js";
import {
  buildExternalContextProjection,
  type ExternalContextProjectionInput,
} from "./model/context-projection.js";
import type { ModelRuntime } from "./model/runtime.js";
import type {
  CanonicalModelToolCallOutput,
  ModelExecutionClass,
  ModelInvocationProvenance,
  ModelRuntimeResult,
} from "./model/types.js";
import type {
  LiveResearchOperation,
  LiveResearchOperationContext,
} from "./live-research-task-executor.js";

export type PinnedLiveResearchExecutionClass = Extract<
  ModelExecutionClass,
  "LIVE_DIRECT" | "LIVE_BROKERED"
>;

export interface PinnedLiveResearchModelConfig {
  readonly model: string;
  readonly requestedProvider: string;
  readonly executionClass: PinnedLiveResearchExecutionClass;
  readonly maxOutputTokens?: number;
}

export interface LiveResearchContextProjectionSource {
  load(context: LiveResearchOperationContext): Promise<ExternalContextProjectionInput>;
}

export interface LiveResearchCapabilityGrantSource {
  load(context: LiveResearchOperationContext): Promise<CapabilityGrant>;
}

export interface LiveResearchPriorOperationSource {
  load(
    operationId: string,
    context: LiveResearchOperationContext,
  ): Promise<PriorCapabilityOperation | undefined>;
}

export type LiveResearchModelRuntime = Pick<ModelRuntime, "call">;

export class LiveResearchModelOperationError extends Error {
  constructor(
    readonly code:
      | "INVALID_CONFIG"
      | "CONTEXT_BINDING_MISMATCH"
      | "CAPABILITY_BINDING_MISMATCH"
      | "INVALID_MODEL_PROPOSAL"
      | "INVALID_CAPABILITY_RESULT",
    message: string,
  ) {
    super(message);
    this.name = "LiveResearchModelOperationError";
  }
}

function nonEmpty(value: string, label: string, max = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new LiveResearchModelOperationError("INVALID_CONFIG", `${label} is invalid.`);
  }
  return normalized;
}

function normalizeConfig(config: PinnedLiveResearchModelConfig): Readonly<Required<PinnedLiveResearchModelConfig>> {
  const maxOutputTokens = config.maxOutputTokens ?? 512;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4096) {
    throw new LiveResearchModelOperationError(
      "INVALID_CONFIG",
      "Pinned live research maxOutputTokens must be an integer between 1 and 4096.",
    );
  }
  if (config.executionClass !== "LIVE_DIRECT" && config.executionClass !== "LIVE_BROKERED") {
    throw new LiveResearchModelOperationError(
      "INVALID_CONFIG",
      "Pinned live research requires LIVE_DIRECT or LIVE_BROKERED execution.",
    );
  }
  return Object.freeze({
    model: nonEmpty(config.model, "model"),
    requestedProvider: nonEmpty(config.requestedProvider, "requestedProvider"),
    executionClass: config.executionClass,
    maxOutputTokens,
  });
}

function assertProjectionMatchesContext(
  context: LiveResearchOperationContext,
  input: ExternalContextProjectionInput,
): ReturnType<typeof buildExternalContextProjection> {
  const projection = buildExternalContextProjection(input);
  if (
    projection.role !== "RESEARCH"
    || projection.runId !== context.binding.runId
    || projection.intentScopeId !== context.binding.intentScopeId
    || projection.intentVersionId !== context.binding.intentVersionId
    || projection.research?.checkpointId !== context.checkpointHash
    || projection.research?.queryMaterial !== context.request.query
  ) {
    throw new LiveResearchModelOperationError(
      "CONTEXT_BINDING_MISMATCH",
      "External research context does not match the exact V36 task, Run, and IntentVersion binding.",
    );
  }
  return projection;
}

function assertGrantMatchesContext(
  context: LiveResearchOperationContext,
  grant: CapabilityGrant,
): void {
  if (
    grant.runId !== context.binding.runId
    || grant.subjectId !== context.binding.subjectId
    || grant.intentVersionId !== context.binding.intentVersionId
    || grant.role !== "RESEARCH"
  ) {
    throw new LiveResearchModelOperationError(
      "CAPABILITY_BINDING_MISMATCH",
      "Live research capability grant does not match the exact Run, subject, IntentVersion, and role binding.",
    );
  }
}

function exactToolProposal(result: ModelRuntimeResult): CanonicalModelToolCallOutput {
  if (result.response.output.length !== 1 || result.response.output[0]?.type !== "tool_call") {
    throw new LiveResearchModelOperationError(
      "INVALID_MODEL_PROPOSAL",
      "Live research model must emit exactly one capability proposal and no free-form output.",
    );
  }
  return result.response.output[0];
}

function operationId(context: LiveResearchOperationContext, grant: CapabilityGrant): string {
  return [
    "m9-5",
    context.task.id,
    context.request.id,
    grant.capabilityId,
    grant.capabilityVersion,
  ].join(":");
}

function attachOperationalProvenance(
  result: unknown,
  invocationProvenance: ModelInvocationProvenance,
  capability: {
    operationId: string;
    capabilityId: string;
    capabilityVersion: string;
    reused: boolean;
  },
): Readonly<Record<string, unknown>> {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new LiveResearchModelOperationError(
      "INVALID_CAPABILITY_RESULT",
      "Live research capability result must be a JSON object suitable for the durable V36 handoff.",
    );
  }
  return Object.freeze({
    ...structuredClone(result as Record<string, unknown>),
    operationalProvenance: Object.freeze({
      modelInvocation: structuredClone(invocationProvenance),
      capability: Object.freeze({ ...capability }),
    }),
  });
}

/**
 * Provider-neutral M9-5 operation composition. The model sees only the M9-3
 * projection and may emit only one M9-2-granted capability proposal. The
 * capability output remains operational data; V36 admission remains downstream.
 */
export class PinnedLiveResearchModelOperation implements LiveResearchOperation {
  private readonly config: Readonly<Required<PinnedLiveResearchModelConfig>>;

  constructor(
    config: PinnedLiveResearchModelConfig,
    private readonly runtime: LiveResearchModelRuntime,
    private readonly contextSource: LiveResearchContextProjectionSource,
    private readonly grantSource: LiveResearchCapabilityGrantSource,
    private readonly guard: CapabilityStateGuard,
    private readonly capabilityExecutor: CapabilityExecutor,
    private readonly priorOperationSource?: LiveResearchPriorOperationSource,
  ) {
    this.config = normalizeConfig(config);
  }

  async execute(context: LiveResearchOperationContext): Promise<unknown> {
    const projectionInput = await this.contextSource.load(context);
    const projection = assertProjectionMatchesContext(context, projectionInput);
    const grant = await this.grantSource.load(context);
    assertGrantMatchesContext(context, grant);

    const modelResult = await this.runtime.call(
      {
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: "Use only the licensed research context. Emit exactly one granted tool call. Do not emit prose or claim truth authority.",
          },
          {
            role: "user",
            content: JSON.stringify(projection),
          },
        ],
        tools: [grant.tool],
        temperature: 0,
        maxOutputTokens: this.config.maxOutputTokens,
      },
      {
        correlationId: `m9-5:${context.task.id}`,
        idempotencyKey: context.task.taskFingerprint,
        maxAttempts: 1,
        invocation: {
          executionClass: this.config.executionClass,
          routeMode: "PINNED",
          requestedProvider: this.config.requestedProvider,
        },
      },
    );

    const proposal = exactToolProposal(modelResult);
    const stableOperationId = operationId(context, grant);
    const priorOperation = await this.priorOperationSource?.load(stableOperationId, context);
    const executed = await executeCapabilityProposal(
      grant,
      {
        proposal,
        operationId: stableOperationId,
        runId: context.binding.runId,
        subjectId: context.binding.subjectId,
        intentVersionId: context.binding.intentVersionId,
        role: "RESEARCH",
        callNumber: 1,
        ...(priorOperation === undefined ? {} : { priorOperation }),
      },
      this.guard,
      this.capabilityExecutor,
    );

    return attachOperationalProvenance(
      executed.result,
      modelResult.audit.invocationProvenance,
      {
        operationId: executed.operationId,
        capabilityId: executed.capabilityId,
        capabilityVersion: executed.capabilityVersion,
        reused: executed.reused,
      },
    );
  }
}
