import type {
  CanonicalModelToolCallOutput,
  CanonicalModelToolDefinition,
  CanonicalModelToolProperty,
} from "./model/types.js";

export type CapabilityIdempotencyClass = "IDEMPOTENT" | "NON_IDEMPOTENT";
export type CapabilityRole = "MODEL_ASSISTANCE" | "RESEARCH";

export type CapabilityEgressPolicy =
  | Readonly<{ kind: "NONE" }>
  | Readonly<{ kind: "ALLOWLIST"; origins: readonly string[] }>;

export interface CapabilityGrant {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly runId: string;
  readonly subjectId: string;
  readonly intentVersionId: string;
  readonly role: CapabilityRole;
  readonly tool: CanonicalModelToolDefinition;
  readonly maxCalls: number;
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly egress: CapabilityEgressPolicy;
  readonly idempotency: CapabilityIdempotencyClass;
}

export type CapabilityBindingState =
  | "ACTIVE"
  | "STALE_RUN"
  | "SUPERSEDED_INTENT"
  | "SUBJECT_UNAVAILABLE"
  | "DELETED";

export interface CapabilityBindingCheck {
  readonly runId: string;
  readonly subjectId: string;
  readonly intentVersionId: string;
}

export interface CapabilityStateGuard {
  check(binding: CapabilityBindingCheck): Promise<CapabilityBindingState>;
}

export type PriorCapabilityOperation =
  | Readonly<{ operationId: string; state: "SUCCEEDED"; result: unknown }>
  | Readonly<{ operationId: string; state: "AMBIGUOUS" }>;

export interface CapabilityExecutionRequest {
  readonly proposal: CanonicalModelToolCallOutput;
  readonly operationId: string;
  readonly runId: string;
  readonly subjectId: string;
  readonly intentVersionId: string;
  readonly role: CapabilityRole;
  readonly callNumber: number;
  readonly signal?: AbortSignal;
  readonly priorOperation?: PriorCapabilityOperation;
}

export interface CapabilityExecutorContext {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly operationId: string;
  readonly runId: string;
  readonly subjectId: string;
  readonly intentVersionId: string;
  readonly role: CapabilityRole;
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
  readonly egress: CapabilityEgressPolicy;
  readonly signal: AbortSignal;
}

export interface CapabilityExecutor {
  execute(context: CapabilityExecutorContext): Promise<unknown>;
}

export interface CapabilityExecutionResult {
  readonly operationId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly reused: boolean;
  readonly result: unknown;
}

export type CapabilityExecutionErrorCode =
  | "INVALID_GRANT"
  | "BINDING_MISMATCH"
  | "BINDING_INACTIVE"
  | "UNDECLARED_CAPABILITY"
  | "INVALID_ARGUMENTS"
  | "BUDGET_EXCEEDED"
  | "CANCELLED"
  | "TIMEOUT"
  | "AMBIGUOUS_REDISPATCH"
  | "OUTPUT_TOO_LARGE"
  | "BINDING_CHANGED_AFTER_EXECUTION";

export class CapabilityExecutionError extends Error {
  constructor(
    readonly code: CapabilityExecutionErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string | number | boolean | null>> = Object.freeze({}),
  ) {
    super(message);
    this.name = "CapabilityExecutionError";
  }
}

function nonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new CapabilityExecutionError("INVALID_GRANT", `${label} must be non-empty.`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CapabilityExecutionError("INVALID_GRANT", `${label} must be a positive safe integer.`);
  }
  return value;
}

function assertEgressPolicy(policy: CapabilityEgressPolicy): CapabilityEgressPolicy {
  if (policy.kind === "NONE") return Object.freeze({ kind: "NONE" });
  if (!Array.isArray(policy.origins) || policy.origins.length === 0 || policy.origins.length > 32) {
    throw new CapabilityExecutionError(
      "INVALID_GRANT",
      "ALLOWLIST egress must contain 1-32 exact HTTPS origins.",
    );
  }
  const origins = policy.origins.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new CapabilityExecutionError("INVALID_GRANT", `Invalid egress origin: ${entry}`);
    }
    if (url.protocol !== "https:" || url.origin !== entry || url.username || url.password) {
      throw new CapabilityExecutionError(
        "INVALID_GRANT",
        `Egress entries must be exact credential-free HTTPS origins: ${entry}`,
      );
    }
    return entry;
  });
  if (new Set(origins).size !== origins.length || origins.some((entry) => entry.includes("*"))) {
    throw new CapabilityExecutionError(
      "INVALID_GRANT",
      "Egress allowlist must contain unique exact origins and cannot contain wildcards.",
    );
  }
  return Object.freeze({ kind: "ALLOWLIST", origins: Object.freeze(origins) });
}

export function normalizeCapabilityGrant(grant: CapabilityGrant): CapabilityGrant {
  const tool = grant.tool;
  nonEmpty(grant.capabilityId, "capabilityId");
  nonEmpty(grant.capabilityVersion, "capabilityVersion");
  nonEmpty(grant.runId, "runId");
  nonEmpty(grant.subjectId, "subjectId");
  nonEmpty(grant.intentVersionId, "intentVersionId");
  if (grant.role !== "MODEL_ASSISTANCE" && grant.role !== "RESEARCH") {
    throw new CapabilityExecutionError("INVALID_GRANT", "role is invalid.");
  }
  if (!tool || tool.name.trim().length === 0 || tool.inputSchema?.type !== "object") {
    throw new CapabilityExecutionError("INVALID_GRANT", "tool definition is invalid.");
  }
  if (tool.inputSchema.additionalProperties !== false) {
    throw new CapabilityExecutionError(
      "INVALID_GRANT",
      "Capability tool schemas must fail closed with additionalProperties=false.",
    );
  }
  positiveSafeInteger(grant.maxCalls, "maxCalls");
  positiveSafeInteger(grant.timeoutMs, "timeoutMs");
  positiveSafeInteger(grant.maxInputBytes, "maxInputBytes");
  positiveSafeInteger(grant.maxOutputBytes, "maxOutputBytes");
  if (grant.idempotency !== "IDEMPOTENT" && grant.idempotency !== "NON_IDEMPOTENT") {
    throw new CapabilityExecutionError("INVALID_GRANT", "idempotency is invalid.");
  }
  return Object.freeze({
    ...grant,
    egress: assertEgressPolicy(grant.egress),
  });
}

function validateProperty(
  property: CanonicalModelToolProperty,
  value: unknown,
  label: string,
): string | number | boolean {
  const valid = property.type === "string"
    ? typeof value === "string"
    : property.type === "boolean"
      ? typeof value === "boolean"
      : property.type === "integer"
        ? typeof value === "number" && Number.isSafeInteger(value)
        : typeof value === "number" && Number.isFinite(value);
  if (!valid) {
    throw new CapabilityExecutionError("INVALID_ARGUMENTS", `${label} does not match the granted schema.`);
  }
  if (property.enum !== undefined && !property.enum.some((entry) => Object.is(entry, value))) {
    throw new CapabilityExecutionError("INVALID_ARGUMENTS", `${label} is outside the granted enum.`);
  }
  return value as string | number | boolean;
}

function validateProposal(
  grant: CapabilityGrant,
  proposal: CanonicalModelToolCallOutput,
): Readonly<Record<string, string | number | boolean>> {
  if (proposal.type !== "tool_call" || proposal.name !== grant.tool.name) {
    throw new CapabilityExecutionError(
      "UNDECLARED_CAPABILITY",
      `Model proposal ${proposal.name} is not the exact granted capability tool ${grant.tool.name}.`,
    );
  }
  const schema = grant.tool.inputSchema;
  const required = new Set(schema.required ?? []);
  for (const name of required) {
    if (!(name in proposal.arguments)) {
      throw new CapabilityExecutionError("INVALID_ARGUMENTS", `arguments.${name} is required.`);
    }
  }
  const parsed: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(proposal.arguments)) {
    const property = schema.properties[name];
    if (property === undefined) {
      throw new CapabilityExecutionError(
        "INVALID_ARGUMENTS",
        `arguments.${name} is not licensed by the capability grant.`,
      );
    }
    parsed[name] = validateProperty(property, value, `arguments.${name}`);
  }
  return Object.freeze(parsed);
}

function assertExactBinding(grant: CapabilityGrant, request: CapabilityExecutionRequest): void {
  const matches = grant.runId === request.runId
    && grant.subjectId === request.subjectId
    && grant.intentVersionId === request.intentVersionId
    && grant.role === request.role;
  if (!matches) {
    throw new CapabilityExecutionError(
      "BINDING_MISMATCH",
      "Capability execution must preserve the exact Run, subject, IntentVersion, and role binding.",
    );
  }
}

async function assertActiveBinding(
  guard: CapabilityStateGuard,
  grant: CapabilityGrant,
  afterExecution: boolean,
): Promise<void> {
  const state = await guard.check({
    runId: grant.runId,
    subjectId: grant.subjectId,
    intentVersionId: grant.intentVersionId,
  });
  if (state !== "ACTIVE") {
    throw new CapabilityExecutionError(
      afterExecution ? "BINDING_CHANGED_AFTER_EXECUTION" : "BINDING_INACTIVE",
      afterExecution
        ? `Capability completed but Product binding became ${state}; result cannot be released as current Product output.`
        : `Capability dispatch denied because Product binding is ${state}.`,
      Object.freeze({ state }),
    );
  }
}

function byteLength(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new CapabilityExecutionError("OUTPUT_TOO_LARGE", "Capability value is not JSON-serializable.");
  }
  return Buffer.byteLength(serialized ?? "null", "utf8");
}

async function executeWithAbort(
  executor: CapabilityExecutor,
  context: Omit<CapabilityExecutorContext, "signal">,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): Promise<unknown> {
  if (callerSignal?.aborted) {
    throw new CapabilityExecutionError("CANCELLED", "Capability execution was cancelled before dispatch.");
  }
  const controller = new AbortController();
  let callerAbort: (() => void) | undefined;
  if (callerSignal !== undefined) {
    callerAbort = () => controller.abort(callerSignal.reason ?? new Error("Cancelled."));
    callerSignal.addEventListener("abort", callerAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("Capability timeout.")), timeoutMs);
  const operation = executor.execute(Object.freeze({ ...context, signal: controller.signal }));
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } catch (error) {
    if (callerSignal?.aborted) {
      throw new CapabilityExecutionError("CANCELLED", "Capability execution was cancelled.");
    }
    if (controller.signal.aborted) {
      throw new CapabilityExecutionError("TIMEOUT", "Capability execution exceeded its timeout.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (callerSignal !== undefined && callerAbort !== undefined) {
      callerSignal.removeEventListener("abort", callerAbort);
    }
    void operation.catch(() => undefined);
  }
}

/**
 * Stateless Product-owned policy boundary for an already-normalized model tool
 * proposal. Durable task identity, retry scheduling, leases, and immutable
 * result persistence remain owned by the existing Execution Runtime stores.
 */
export async function executeCapabilityProposal(
  rawGrant: CapabilityGrant,
  request: CapabilityExecutionRequest,
  guard: CapabilityStateGuard,
  executor: CapabilityExecutor,
): Promise<CapabilityExecutionResult> {
  const grant = normalizeCapabilityGrant(rawGrant);
  nonEmpty(request.operationId, "operationId");
  assertExactBinding(grant, request);
  if (!Number.isSafeInteger(request.callNumber) || request.callNumber < 1 || request.callNumber > grant.maxCalls) {
    throw new CapabilityExecutionError(
      "BUDGET_EXCEEDED",
      `Capability call ${request.callNumber} exceeds the granted call budget ${grant.maxCalls}.`,
    );
  }

  const args = validateProposal(grant, request.proposal);
  if (byteLength(args) > grant.maxInputBytes) {
    throw new CapabilityExecutionError("BUDGET_EXCEEDED", "Capability input exceeds the granted byte budget.");
  }

  const prior = request.priorOperation;
  if (prior !== undefined) {
    if (prior.operationId !== request.operationId) {
      throw new CapabilityExecutionError(
        "BINDING_MISMATCH",
        "Prior operation evidence does not match this operation identity.",
      );
    }
    if (prior.state === "SUCCEEDED") {
      await assertActiveBinding(guard, grant, false);
      return Object.freeze({
        operationId: request.operationId,
        capabilityId: grant.capabilityId,
        capabilityVersion: grant.capabilityVersion,
        reused: true,
        result: structuredClone(prior.result),
      });
    }
    if (grant.idempotency === "NON_IDEMPOTENT") {
      throw new CapabilityExecutionError(
        "AMBIGUOUS_REDISPATCH",
        "Non-idempotent capability completion is ambiguous; Product must not blindly redispatch it.",
      );
    }
  }

  await assertActiveBinding(guard, grant, false);
  const result = await executeWithAbort(
    executor,
    {
      capabilityId: grant.capabilityId,
      capabilityVersion: grant.capabilityVersion,
      operationId: request.operationId,
      runId: grant.runId,
      subjectId: grant.subjectId,
      intentVersionId: grant.intentVersionId,
      role: grant.role,
      arguments: args,
      egress: grant.egress,
    },
    grant.timeoutMs,
    request.signal,
  );
  if (byteLength(result) > grant.maxOutputBytes) {
    throw new CapabilityExecutionError("OUTPUT_TOO_LARGE", "Capability output exceeds the granted byte budget.");
  }
  await assertActiveBinding(guard, grant, true);
  return Object.freeze({
    operationId: request.operationId,
    capabilityId: grant.capabilityId,
    capabilityVersion: grant.capabilityVersion,
    reused: false,
    result: structuredClone(result),
  });
}
