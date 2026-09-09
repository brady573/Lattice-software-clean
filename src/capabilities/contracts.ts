import type { ModelInvocationProvenance } from "../model/types.js";

export type CapabilityEffect = "COGNITIVE_ONLY";
export type CapabilityTrustHandling = "NON_AUTHORITATIVE_PROPOSAL" | "KNOWLEDGE_REVIEW_REQUIRED";
export type CapabilityAuthorizationRequirement = "EXPLICIT_SUBJECT_GRANT";

export type CapabilityProvenance =
  | (Readonly<{
    kind: "MODEL";
    source: "MODEL_RUNTIME";
  }> & ModelInvocationProvenance)
  | Readonly<{
    kind: "CAPABILITY";
    source: string;
    details?: Readonly<Record<string, string>>;
    actualProvider?: never;
    actualModel?: never;
  }>;

export interface CapabilityContract<Input, Output> {
  readonly id: string;
  readonly description: string;
  readonly authorizationRequirement: CapabilityAuthorizationRequirement;
  readonly effect: CapabilityEffect;
  readonly trustHandling: CapabilityTrustHandling;
  readonly inputContract: string;
  readonly outputContract: string;
  invoke(input: Input, context: CapabilityExecutionContext): Promise<CapabilityExecutionResult<Output>>;
}

export interface CapabilityExecutionContext {
  readonly subjectId: string;
  readonly requestId: string;
  readonly authorizationVersion: number;
  readonly purpose: string;
  readonly requester: "SOLANDRA";
}

export interface CapabilityExecutionResult<Output> {
  readonly output: Output;
  readonly provenance: CapabilityProvenance | null;
}

export interface CapabilityInvocationResult<Output> {
  readonly capabilityId: string;
  readonly purpose: string;
  readonly requester: "SOLANDRA";
  readonly effect: CapabilityEffect;
  readonly trustHandling: CapabilityTrustHandling;
  readonly authorizationVersion: number;
  readonly output: Output;
  readonly provenance: CapabilityProvenance | null;
}
