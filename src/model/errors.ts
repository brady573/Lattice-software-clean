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

export class ModelProviderError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: ModelErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly statusCode?: number | null;
      readonly retryAfterMs?: number | null;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? null;
    const retryAfterMs = options.retryAfterMs ?? null;
    if (
      retryAfterMs !== null
      && (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)
    ) {
      throw new Error("Model provider retryAfterMs must be a non-negative safe integer.");
    }
    this.retryAfterMs = retryAfterMs;
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
