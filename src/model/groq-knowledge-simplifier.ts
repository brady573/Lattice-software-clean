import { ModelProviderError, type ModelProviderUpstreamError } from "./errors.js";
import type { ModelProvider } from "./provider.js";
import { ModelRuntime } from "./runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelCallOptions,
  ModelProviderResult,
  ModelRuntimeResult,
} from "./types.js";

export const GROQ_KNOWLEDGE_SIMPLIFIER_PROVIDER = "groq";
export const GROQ_KNOWLEDGE_SIMPLIFIER_MODEL = "openai/gpt-oss-120b";
export const GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL = "https://api.groq.com/openai/v1";

const LIVE_DIRECT_INVOCATION = Object.freeze({
  executionClass: "LIVE_DIRECT" as const,
  routeMode: "PINNED" as const,
  requestedProvider: GROQ_KNOWLEDGE_SIMPLIFIER_PROVIDER,
});

const providerErrorLimits = Object.freeze({
  code: 256,
  type: 256,
  param: 512,
  message: 4 * 1024,
});

export interface GroqCompletionDiagnostic {
  readonly content: string;
  readonly finishReason: string | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly upstreamRequestId: string | null;
}

export type GroqCompletionDiagnosticSink = (diagnostic: GroqCompletionDiagnostic) => void;

export interface GroqKnowledgeSimplifierProviderOptions {
  readonly apiKey: string;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
  /** Optional test/development-only observability. It has no Product authority or response effect. */
  readonly diagnosticSink?: GroqCompletionDiagnosticSink;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireApiKey(value: string): string {
  if (!value.trim() || value.length < 16 || value.length > 512) {
    throw new Error("Groq Knowledge simplifier API key must contain between 16 and 512 characters.");
  }
  return value;
}

function optionalFiniteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sanitizeProviderErrorField(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!sanitized) return null;
  return sanitized.slice(0, maxChars);
}

function parseGroqProviderError(text: string): ModelProviderUpstreamError | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const error = asRecord(asRecord(body)?.error);
  if (error === null) return null;
  const parsed = Object.freeze({
    code: sanitizeProviderErrorField(error.code, providerErrorLimits.code),
    type: sanitizeProviderErrorField(error.type, providerErrorLimits.type),
    param: sanitizeProviderErrorField(error.param, providerErrorLimits.param),
    message: sanitizeProviderErrorField(error.message, providerErrorLimits.message),
  });
  return parsed.code === null && parsed.type === null && parsed.param === null && parsed.message === null
    ? null
    : parsed;
}

function structuredResponseFormat(request: CanonicalModelRequest): unknown {
  const contract = request.structuredOutput;
  if (contract === undefined) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: contract.name,
      strict: contract.strict,
      schema: contract.schema,
    },
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ModelProviderError(
          "response_too_large",
          "Groq Knowledge simplifier response exceeded its byte limit.",
          { statusCode: 502 },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Narrow pinned Groq route. Structured output, when required by the canonical
 * request, is mapped only as a format constraint; it grants no Product authority.
 */
export class GroqKnowledgeSimplifierModelProvider implements ModelProvider {
  readonly kind = "groq-knowledge-simplifier";
  private readonly apiKey: string;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly diagnosticSink: GroqCompletionDiagnosticSink | undefined;

  constructor(options: GroqKnowledgeSimplifierProviderOptions) {
    this.apiKey = requireApiKey(options.apiKey);
    this.maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error("Groq Knowledge simplifier maxResponseBytes must be a positive safe integer.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.diagnosticSink = options.diagnosticSink;
  }

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    if (request.model !== GROQ_KNOWLEDGE_SIMPLIFIER_MODEL) {
      throw new ModelProviderError(
        "unsupported_capability",
        "Groq Knowledge simplifier accepts only its pinned model.",
      );
    }
    if (request.tools !== undefined && request.tools.length > 0) {
      throw new ModelProviderError(
        "unsupported_capability",
        "Groq Knowledge simplifier does not accept tool calls.",
      );
    }

    const responseFormat = structuredResponseFormat(request);
    let response: Response;
    try {
      response = await this.fetchImpl(`${GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL}/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.apiKey}`,
          "x-lattice-correlation-id": context.correlationId,
        },
        body: JSON.stringify({
          model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
          messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
          temperature: request.temperature ?? 0,
          reasoning_effort: "low",
          ...(request.maxOutputTokens === undefined
            ? {}
            : { max_completion_tokens: request.maxOutputTokens }),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
          ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
        }),
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) {
        throw new ModelProviderError(
          "cancelled",
          "Groq Knowledge simplifier request was cancelled.",
          { cause: error },
        );
      }
      throw new ModelProviderError(
        "unavailable",
        "Groq Knowledge simplifier endpoint was unavailable.",
        { retryable: true, cause: error },
      );
    }

    const text = await readBoundedText(response, this.maxResponseBytes);
    if (!response.ok) {
      if (response.status === 429) {
        throw new ModelProviderError(
          "rate_limit",
          "Groq Knowledge simplifier route was rate limited.",
          { retryable: true, statusCode: 429 },
        );
      }
      if (request.structuredOutput !== undefined && response.status === 400) {
        const providerError = parseGroqProviderError(text);
        if (providerError?.code === "json_validate_failed") {
          throw new ModelProviderError(
            "invalid_output",
            "Groq generated output that failed the required structured-output contract.",
            { statusCode: 400, providerError },
          );
        }
        throw new ModelProviderError(
          "unsupported_capability",
          "Groq rejected the required structured-output contract.",
          { statusCode: 400, providerError },
        );
      }
      throw new ModelProviderError(
        "unavailable",
        `Groq Knowledge simplifier returned HTTP ${response.status}.`,
        { retryable: response.status >= 500, statusCode: response.status },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new ModelProviderError(
        "malformed_response",
        "Groq Knowledge simplifier returned malformed JSON.",
        { statusCode: 502, cause: error },
      );
    }

    const root = asRecord(body);
    const actualModel = typeof root?.model === "string" ? root.model.trim() : "";
    if (actualModel !== GROQ_KNOWLEDGE_SIMPLIFIER_MODEL) {
      throw new ModelProviderError(
        "invalid_output",
        "Groq Knowledge simplifier response did not prove the pinned model identity.",
        { statusCode: 502 },
      );
    }

    const choices = root?.choices;
    if (!Array.isArray(choices) || choices.length !== 1) {
      throw new ModelProviderError(
        "invalid_output",
        "Groq Knowledge simplifier must return exactly one completion choice.",
        { statusCode: 502 },
      );
    }
    const choice = asRecord(choices[0]);
    const message = choice === null ? null : asRecord(choice.message);
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!content) {
      throw new ModelProviderError(
        "invalid_output",
        "Groq Knowledge simplifier returned no plain-text content.",
        { statusCode: 502 },
      );
    }

    const upstreamRequestId = typeof root?.id === "string" && root.id.trim()
      ? root.id.trim()
      : undefined;
    const finishReason = typeof choice?.finish_reason === "string" && choice.finish_reason.trim()
      ? choice.finish_reason.trim()
      : null;
    const usage = asRecord(root?.usage);
    const promptTokens = optionalFiniteInteger(usage?.prompt_tokens);
    const completionTokens = optionalFiniteInteger(usage?.completion_tokens);
    const totalTokens = optionalFiniteInteger(usage?.total_tokens);

    this.diagnosticSink?.(Object.freeze({
      content,
      finishReason,
      promptTokens,
      completionTokens,
      totalTokens,
      upstreamRequestId: upstreamRequestId ?? null,
    }));

    return {
      response: {
        id: upstreamRequestId ?? `groq-${context.requestIdentity.slice(0, 16)}-${context.attempt}`,
        model: actualModel,
        output: [{ type: "text", text: content }],
      },
      metadata: {
        upstreamStatus: response.status,
        upstreamRequestId: upstreamRequestId ?? null,
        finishReason,
        promptTokens,
        completionTokens,
        totalTokens,
        structuredOutputMode: request.structuredOutput === undefined
          ? null
          : request.structuredOutput.strict ? "json_schema_strict" : "json_schema",
      },
      route: {
        actualProvider: GROQ_KNOWLEDGE_SIMPLIFIER_PROVIDER,
        actualModel,
        ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
      },
    };
  }
}

/** Fixed LIVE_DIRECT/PINNED route declaration; callers cannot reclassify it. */
export class GroqKnowledgeSimplifierModelRuntime extends ModelRuntime {
  constructor(provider: ModelProvider, timeoutMs = 30_000) {
    super(provider, { timeoutMs });
  }

  override async call(
    rawRequest: unknown,
    options: ModelCallOptions,
  ): Promise<ModelRuntimeResult> {
    if (options.invocation !== undefined) {
      throw new Error("GroqKnowledgeSimplifierModelRuntime does not allow per-call invocation overrides.");
    }
    return await super.call(rawRequest, {
      ...options,
      invocation: LIVE_DIRECT_INVOCATION,
    });
  }
}
