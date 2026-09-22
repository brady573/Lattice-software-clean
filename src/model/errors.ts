export type ModelErrorCode =
  | "cancelled"
  | "timeout"
  | "unavailable"
  | "rate_limit"
  | "malformed_response"
  | "invalid_output"
  | "response_too_large"
  | "unsupported_capability"
  | "fixture_not_found";

export type ModelFailurePhase =
  | "QUEUE"
  | "RATE_LIMIT_WAIT"
  | "PROVIDER_REQUEST"
  | "PROVIDER_RESPONSE"
  | "RETRY"
  | "UNKNOWN";

export interface ModelFailureDiagnostic {
  readonly timeoutPhase: ModelFailurePhase;
  readonly queueMs: number;
  readonly rateLimitWaitMs: number;
  readonly providerRequestMs: number;
  readonly retryMs: number;
  readonly totalMs: number;
  readonly attemptsStarted: number;
  readonly retryCount: number;
  readonly providerStatus: number | null;
  readonly rateLimitRecoveryMs: number | null;
  readonly rateLimitLimitTokens: number | null;
  readonly rateLimitRemainingTokens: number | null;
  readonly rateLimitResetTokensMs: number | null;
  readonly requestBytes: number;
  readonly maxOutputTokens: number | null;
}

export class ModelProviderError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly diagnostic: ModelFailureDiagnostic | null;

  constructor(
    code: ModelErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly statusCode?: number | null;
      readonly cause?: unknown;
      readonly diagnostic?: ModelFailureDiagnostic;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? null;
    this.diagnostic = options.diagnostic ?? null;
  }
}

export function asModelProviderError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  return new ModelProviderError(
    "unavailable",
    error instanceof Error ? error.message : "Model provider failed.",
    { cause: error },
  );
}

export function withModelFailureDiagnostic(
  error: ModelProviderError,
  diagnostic: ModelFailureDiagnostic,
): ModelProviderError {
  return new ModelProviderError(error.code, error.message, {
    retryable: error.retryable,
    statusCode: error.statusCode,
    cause: error,
    diagnostic,
  });
}
