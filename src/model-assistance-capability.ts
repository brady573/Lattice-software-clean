import type {
  ModelAssistanceAuthorizationState,
  ModelAssistanceAuthorizationStore,
  ModelAssistanceInvocationEvidence,
} from "./model-assistance-store.js";
import { modelAssistanceInvocationProvenance } from "./model-assistance-store.js";
import type {
  KnowledgeSimplificationAttempt,
  KnowledgeSimplificationInput,
  KnowledgeSimplifier,
} from "./presentation/solandra/knowledge-simplification.js";

export const MODEL_ASSISTANCE_CAPABILITY_ID = "plain-language-model-assistance" as const;
export type ModelAssistanceProductStatus = "UNAVAILABLE" | "DISCONNECTED" | "CONNECTED";

export interface ModelAssistanceProductState {
  capabilityId: typeof MODEL_ASSISTANCE_CAPABILITY_ID;
  status: ModelAssistanceProductStatus;
  authorized: boolean;
  description: string;
  authorization: string;
  limitation: string;
  version: number;
  updatedAt: string | null;
  lastInvocation: ModelAssistanceAuthorizationState["lastInvocation"];
}

export class ModelAssistanceUnavailableError extends Error {
  constructor() {
    super("Model assistance is not available in this Lattice setup.");
    this.name = "ModelAssistanceUnavailableError";
  }
}

function publicState(
  stored: ModelAssistanceAuthorizationState,
  available: boolean,
): ModelAssistanceProductState {
  const status: ModelAssistanceProductStatus = !available
    ? "UNAVAILABLE"
    : stored.status === "CONNECTED"
      ? "CONNECTED"
      : "DISCONNECTED";
  return Object.freeze({
    capabilityId: MODEL_ASSISTANCE_CAPABILITY_ID,
    status,
    authorized: status === "CONNECTED",
    description: "Plain-language model assistance for already-governed Knowledge.",
    authorization: "When connected, Lattice may use the configured model service only for this bounded assistance on your behalf.",
    limitation: "Model assistance does not decide what you mean, establish truth, make decisions, or authorize actions.",
    version: stored.version,
    updatedAt: stored.updatedAt,
    lastInvocation: stored.lastInvocation === null ? null : structuredClone(stored.lastInvocation),
  });
}

async function invokeDelegate(
  delegate: KnowledgeSimplifier,
  input: KnowledgeSimplificationInput,
): Promise<KnowledgeSimplificationAttempt> {
  if (delegate.simplifyWithAudit !== undefined) {
    return await delegate.simplifyWithAudit(input);
  }
  const text = await delegate.simplify(input);
  return text === null
    ? Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance: null })
    : Object.freeze({ status: "SIMPLIFIED", text, invocationProvenance: null });
}

function evidenceFor(
  input: KnowledgeSimplificationInput,
  attempt: KnowledgeSimplificationAttempt,
): ModelAssistanceInvocationEvidence | null {
  const recordedAt = new Date().toISOString();
  switch (attempt.status) {
    case "SIMPLIFIED":
      return {
        runId: input.runId,
        outcome: "SUCCEEDED",
        recordedAt,
        provenance: attempt.invocationProvenance === null
          ? null
          : modelAssistanceInvocationProvenance(attempt.invocationProvenance),
        failureCode: null,
      };
    case "FIDELITY_REJECTED":
      return {
        runId: input.runId,
        outcome: "FIDELITY_REJECTED",
        recordedAt,
        provenance: attempt.invocationProvenance === null
          ? null
          : modelAssistanceInvocationProvenance(attempt.invocationProvenance),
        failureCode: null,
      };
    case "PROVIDER_FAILURE":
      return {
        runId: input.runId,
        outcome: "PROVIDER_FAILURE",
        recordedAt,
        provenance: null,
        failureCode: attempt.errorCode,
      };
    case "CAPABILITY_REVOKED":
      return {
        runId: input.runId,
        outcome: "REVOKED",
        recordedAt,
        provenance: null,
        failureCode: null,
      };
    case "CAPABILITY_NOT_AUTHORIZED":
    case "CAPABILITY_UNAVAILABLE":
      return null;
  }
}

class SubjectAuthorizedKnowledgeSimplifier implements KnowledgeSimplifier {
  constructor(
    private readonly subjectId: string,
    private readonly store: ModelAssistanceAuthorizationStore,
    private readonly delegate: KnowledgeSimplifier | undefined,
  ) {}

  async simplifyWithAudit(input: KnowledgeSimplificationInput): Promise<KnowledgeSimplificationAttempt> {
    if (this.delegate === undefined) {
      return Object.freeze({ status: "CAPABILITY_UNAVAILABLE", text: null });
    }
    const before = await this.store.get(this.subjectId);
    if (before.status !== "CONNECTED") {
      return Object.freeze({ status: "CAPABILITY_NOT_AUTHORIZED", text: null });
    }

    const attempt = await invokeDelegate(this.delegate, input);
    const after = await this.store.get(this.subjectId);
    if (after.status !== "CONNECTED" || after.version !== before.version) {
      const revoked = Object.freeze({ status: "CAPABILITY_REVOKED", text: null }) satisfies KnowledgeSimplificationAttempt;
      const evidence = evidenceFor(input, revoked);
      if (evidence !== null) await this.store.recordInvocation(this.subjectId, evidence);
      return revoked;
    }

    const evidence = evidenceFor(input, attempt);
    if (evidence !== null) await this.store.recordInvocation(this.subjectId, evidence);
    return attempt;
  }

  async simplify(input: KnowledgeSimplificationInput): Promise<string | null> {
    const attempt = await this.simplifyWithAudit(input);
    return attempt.status === "SIMPLIFIED" ? attempt.text : null;
  }
}

/**
 * Product-owned authorization boundary for one existing bounded model capability.
 * Provider credentials stay inside the configured delegate; this service stores
 * only subject authorization and sanitized invocation evidence.
 */
export class ModelAssistanceCapabilityService {
  constructor(
    private readonly store: ModelAssistanceAuthorizationStore,
    private readonly delegate: KnowledgeSimplifier | undefined,
  ) {}

  async stateFor(subjectId: string): Promise<ModelAssistanceProductState> {
    return publicState(await this.store.get(subjectId), this.delegate !== undefined);
  }

  async connect(subjectId: string): Promise<ModelAssistanceProductState> {
    if (this.delegate === undefined) throw new ModelAssistanceUnavailableError();
    return publicState(await this.store.connect(subjectId), true);
  }

  async disconnect(subjectId: string): Promise<ModelAssistanceProductState> {
    return publicState(await this.store.disconnect(subjectId), this.delegate !== undefined);
  }

  simplifierFor(subjectId: string): KnowledgeSimplifier {
    return new SubjectAuthorizedKnowledgeSimplifier(subjectId, this.store, this.delegate);
  }
}
