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

export interface ModelProviderUpstreamError {
  readonly code: string | null;
  readonly type: string | null;
  readonly param: string | null;
  readonly message: string | null;
}

export class ModelProviderError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly providerError: ModelProviderUpstreamError | null;

  constructor(
    code: ModelErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly statusCode?: number | null;
      readonly providerError?: ModelProviderUpstreamError | null;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? null;
    this.providerError = options.providerError === undefined || options.providerError === null
      ? null
      : Object.freeze({ ...options.providerError });
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
