export type CanonicalModelRole = "system" | "user" | "assistant" | "tool";

export interface CanonicalModelMessage {
  readonly role: CanonicalModelRole;
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
}

export type CanonicalModelScalarType = "string" | "number" | "integer" | "boolean";

export interface CanonicalModelToolProperty {
  readonly type: CanonicalModelScalarType;
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean)[];
}

export interface CanonicalModelToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, CanonicalModelToolProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
}

export interface CanonicalModelToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: CanonicalModelToolInputSchema;
}

export interface CanonicalModelRequest {
  readonly model: string;
  readonly messages: readonly CanonicalModelMessage[];
  readonly tools?: readonly CanonicalModelToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly seed?: number;
}

export interface CanonicalModelTextOutput {
  readonly type: "text";
  readonly text: string;
}

export interface CanonicalModelToolCallOutput {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
}

export type CanonicalModelOutput = CanonicalModelTextOutput | CanonicalModelToolCallOutput;

export interface CanonicalModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CanonicalModelResponse {
  readonly id: string;
  readonly model: string;
  readonly output: readonly CanonicalModelOutput[];
  readonly usage?: CanonicalModelUsage;
}

export type ModelExecutionClass = "LOCAL_OFFLINE" | "LIVE_BROKERED" | "LIVE_DIRECT";

export type ModelRouteMode = "PINNED" | "PRODUCT_ROUTED" | "BROKER_AUTOMATIC";

export type ModelRouteProvenanceCompleteness = "COMPLETE" | "PARTIAL" | "MISSING";

export interface ModelInvocationRouteRequest {
  readonly executionClass: ModelExecutionClass;
  readonly routeMode: ModelRouteMode;
  readonly requestedProvider?: string;
}

export interface ModelProviderRouteObservation {
  readonly actualProvider?: string;
  readonly actualModel?: string;
  readonly brokerIdentity?: string;
  readonly brokerVersion?: string;
  readonly upstreamRequestId?: string;
}

export interface ModelInvocationProvenance {
  readonly executionClass: ModelExecutionClass | null;
  readonly routeMode: ModelRouteMode | null;
  readonly requestedProvider: string | null;
  readonly requestedModel: string;
  readonly actualProvider: string | null;
  readonly actualModel: string | null;
  readonly brokerIdentity: string | null;
  readonly brokerVersion: string | null;
  readonly upstreamRequestId: string | null;
  readonly routeProvenance: ModelRouteProvenanceCompleteness;
}

export type ProviderMetadataValue = string | number | boolean | null;

export interface ModelProviderResult {
  readonly response: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly route?: ModelProviderRouteObservation;
}

export interface ModelCallContext {
  readonly correlationId: string;
  readonly requestIdentity: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface ModelCallOptions {
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly maxAttempts?: number;
  readonly signal?: AbortSignal;
  readonly invocation?: ModelInvocationRouteRequest;
}

export interface ModelCallAudit {
  readonly correlationId: string;
  readonly requestIdentity: string;
  readonly providerKind: string;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly providerMetadata: Readonly<Record<string, ProviderMetadataValue>>;
  readonly invocationProvenance: ModelInvocationProvenance;
}

export interface ModelRuntimeResult {
  readonly response: CanonicalModelResponse;
  readonly audit: ModelCallAudit;
}
