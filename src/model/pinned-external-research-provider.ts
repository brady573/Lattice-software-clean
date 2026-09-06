import { ModelProviderError } from "./errors.js";
import type { ModelProvider } from "./provider.js";
import type {
  CanonicalModelRequest,
  CanonicalModelToolDefinition,
  ModelCallContext,
  ModelProviderResult,
} from "./types.js";

export interface PinnedExternalResearchProviderOptions {
  readonly baseUrl: string;
  readonly providerId: string;
  readonly apiKey: string;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new Error(`${label} is invalid.`);
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toOpenAiTool(tool: CanonicalModelToolDefinition): unknown {
  return {
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: {
        type: "object",
        properties: Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([name, property]) => [
          name,
          {
            type: property.type,
            ...(property.description === undefined ? {} : { description: property.description }),
            ...(property.enum === undefined ? {} : { enum: property.enum }),
          },
        ])),
        ...(tool.inputSchema.required === undefined ? {} : { required: tool.inputSchema.required }),
        additionalProperties: false,
      },
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
        throw new ModelProviderError("response_too_large", "Pinned external model response exceeded its byte limit.", { statusCode: 502 });
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
 * Narrow M9-5 live-model adapter. It supports one pinned external HTTPS route
 * and tool-call output only; it has no routing, fallback, or truth authority.
 */
export class PinnedExternalResearchModelProvider implements ModelProvider {
  readonly kind: string;
  private readonly baseUrl: string;
  private readonly providerId: string;
  private readonly apiKey: string;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PinnedExternalResearchProviderOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("Pinned external research model baseUrl must be credential-free HTTPS.");
    }
    if (url.pathname === "/" || url.pathname === "") {
      throw new Error("Pinned external research model baseUrl must include the fixed API path prefix.");
    }
    this.providerId = nonEmpty(options.providerId, "providerId");
    this.kind = `pinned-external-research:${this.providerId}`;
    this.apiKey = nonEmpty(options.apiKey, "apiKey");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error("maxResponseBytes must be a positive safe integer.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    if (!request.tools || request.tools.length !== 1) {
      throw new ModelProviderError("unsupported_capability", "Pinned external research model requires exactly one granted tool.");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.apiKey}`,
          "x-lattice-correlation-id": context.correlationId,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
          tools: request.tools.map(toOpenAiTool),
          tool_choice: "required",
          temperature: request.temperature ?? 0,
          ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) {
        throw new ModelProviderError("cancelled", "Pinned external model request was cancelled.", { cause: error });
      }
      throw new ModelProviderError("unavailable", "Pinned external model endpoint was unavailable.", { retryable: true, cause: error });
    }

    const text = await readBoundedText(response, this.maxResponseBytes);
    if (!response.ok) {
      if (response.status === 429) {
        throw new ModelProviderError("rate_limit", "Pinned external model route was rate limited.", { retryable: true, statusCode: 429 });
      }
      throw new ModelProviderError("unavailable", `Pinned external model returned HTTP ${response.status}.`, {
        retryable: response.status >= 500,
        statusCode: response.status,
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new ModelProviderError("malformed_response", "Pinned external model returned malformed JSON.", { statusCode: 502, cause: error });
    }
    const root = asRecord(body);
    const choices = root?.choices;
    const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
    const message = choice === null ? null : asRecord(choice.message);
    const calls = message?.tool_calls;
    if (!Array.isArray(calls) || calls.length !== 1) {
      throw new ModelProviderError("invalid_output", "Pinned external research model must return exactly one tool call.", { statusCode: 502 });
    }
    const call = asRecord(calls[0]);
    const fn = call === null ? null : asRecord(call.function);
    if (call === null || fn === null || typeof call.id !== "string" || typeof fn.name !== "string" || typeof fn.arguments !== "string") {
      throw new ModelProviderError("invalid_output", "Pinned external research tool call was malformed.", { statusCode: 502 });
    }
    let args: unknown;
    try {
      args = JSON.parse(fn.arguments);
    } catch (error) {
      throw new ModelProviderError("invalid_output", "Pinned external research tool arguments were not valid JSON.", { statusCode: 502, cause: error });
    }
    const actualModel = typeof root?.model === "string" && root.model.trim() ? root.model : undefined;
    const upstreamRequestId = typeof root?.id === "string" && root.id.trim() ? root.id : undefined;
    return {
      response: {
        id: upstreamRequestId ?? `model-${context.requestIdentity.slice(0, 16)}-${context.attempt}`,
        model: actualModel ?? request.model,
        output: [{ type: "tool_call", id: call.id, name: fn.name, arguments: args }],
      },
      metadata: { upstreamStatus: response.status, upstreamRequestId: upstreamRequestId ?? null },
      route: {
        actualProvider: this.providerId,
        ...(actualModel === undefined ? {} : { actualModel }),
        ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
      },
    };
  }
}
