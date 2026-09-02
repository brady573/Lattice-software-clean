import { ModelProviderError } from "./errors.js";
import type { ModelProvider } from "./provider.js";
import type {
  CanonicalModelRequest,
  CanonicalModelToolDefinition,
  ModelCallContext,
  ModelProviderResult,
} from "./types.js";

interface OpenAiCompatibleProviderOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function toOpenAiTool(tool: CanonicalModelToolDefinition): unknown {
  return {
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(tool.inputSchema.properties).map(([name, property]) => [
            name,
            {
              type: property.type,
              ...(property.description === undefined ? {} : { description: property.description }),
              ...(property.enum === undefined ? {} : { enum: property.enum }),
            },
          ]),
        ),
        ...(tool.inputSchema.required === undefined
          ? {}
          : { required: tool.inputSchema.required }),
        additionalProperties: false,
      },
    },
  };
}

function toOpenAiRequest(request: CanonicalModelRequest): unknown {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name === undefined ? {} : { name: message.name }),
      ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
    })),
    ...(request.tools === undefined
      ? {}
      : { tools: request.tools.map(toOpenAiTool) }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_tokens: request.maxOutputTokens }),
    chat_template_kwargs: { enable_thinking: false },
    ...(request.seed === undefined ? {} : { seed: request.seed }),
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelProviderError(
      "response_too_large",
      `Model provider response exceeded ${maxBytes} bytes.`,
      { statusCode: 502 },
    );
  }
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
          `Model provider response exceeded ${maxBytes} bytes.`,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeUsage(value: unknown): unknown {
  const usage = asRecord(value);
  if (usage === null) return undefined;
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
  };
}

function normalizeResponse(
  body: unknown,
  request: CanonicalModelRequest,
  context: ModelCallContext,
): unknown {
  const record = asRecord(body);
  const choices = record === null ? null : record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelProviderError(
      "invalid_output",
      "OpenAI-compatible response did not contain a choice.",
      { statusCode: 502 },
    );
  }
  const firstChoice = asRecord(choices[0]);
  const message = firstChoice === null ? null : asRecord(firstChoice.message);
  if (message === null) {
    throw new ModelProviderError(
      "invalid_output",
      "OpenAI-compatible response did not contain an assistant message.",
      { statusCode: 502 },
    );
  }

  const output: unknown[] = [];
  if (typeof message.content === "string" && message.content.trim().length > 0) {
    output.push({ type: "text", text: message.content });
  }

  if (Array.isArray(message.tool_calls)) {
    for (const rawCall of message.tool_calls) {
      const call = asRecord(rawCall);
      const fn = call === null ? null : asRecord(call.function);
      if (
        call === null
        || fn === null
        || typeof call.id !== "string"
        || typeof fn.name !== "string"
        || typeof fn.arguments !== "string"
      ) {
        throw new ModelProviderError(
          "invalid_output",
          "OpenAI-compatible tool call was malformed.",
          { statusCode: 502 },
        );
      }
      let args: unknown;
      try {
        args = JSON.parse(fn.arguments);
      } catch (error) {
        throw new ModelProviderError(
          "invalid_output",
          "OpenAI-compatible tool arguments were not valid JSON.",
          { statusCode: 502, cause: error },
        );
      }
      output.push({
        type: "tool_call",
        id: call.id,
        name: fn.name,
        arguments: args,
      });
    }
  }

  if (output.length === 0) {
    throw new ModelProviderError(
      "invalid_output",
      "OpenAI-compatible response contained no licensed output.",
      { statusCode: 502 },
    );
  }

  const id =
    record !== null && typeof record.id === "string" && record.id.trim().length > 0
      ? record.id
      : `model-${context.requestIdentity.slice(0, 16)}-${context.attempt}`;
  const model =
    record !== null && typeof record.model === "string" && record.model.trim().length > 0
      ? record.model
      : request.model;
  const usage = record === null ? undefined : normalizeUsage(record.usage);

  return {
    id,
    model,
    output,
    ...(usage === undefined ? {} : { usage }),
  };
}

export class OpenAiCompatibleModelProvider implements ModelProvider {
  readonly kind = "openai-compatible-local";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions) {
    const url = new URL(options.baseUrl);
    if (!isLoopback(url.hostname)) {
      throw new ModelProviderError(
        "unsupported_capability",
        "The first OpenAI-compatible model adapter is restricted to loopback endpoints.",
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ModelProviderError(
        "unsupported_capability",
        "OpenAI-compatible model endpoint must use HTTP or HTTPS.",
      );
    }
    const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
      throw new Error("maxResponseBytes must be a positive safe integer.");
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey ?? "offline-local";
    this.maxResponseBytes = maxResponseBytes;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.apiKey}`,
          "x-lattice-correlation-id": context.correlationId,
        },
        body: JSON.stringify(toOpenAiRequest(request)),
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) {
        throw new ModelProviderError(
          "cancelled",
          "Model provider request was cancelled.",
          { cause: error },
        );
      }
      throw new ModelProviderError(
        "unavailable",
        "Model provider endpoint was unavailable.",
        { retryable: true, cause: error },
      );
    }

    const text = await readBoundedText(response, this.maxResponseBytes);
    if (!response.ok) {
      if (response.status === 429) {
        throw new ModelProviderError(
          "rate_limit",
          "Model provider rate limited the request.",
          { retryable: true, statusCode: response.status },
        );
      }
      throw new ModelProviderError(
        "unavailable",
        `Model provider returned HTTP ${response.status}.`,
        {
          retryable: response.status >= 500,
          statusCode: response.status,
        },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new ModelProviderError(
        "malformed_response",
        "Model provider returned malformed JSON.",
        { statusCode: 502, cause: error },
      );
    }

    const record = asRecord(body);
    const upstreamRequestId =
      typeof record?.id === "string" && record.id.trim().length > 0
        ? record.id
        : undefined;
    const actualModel =
      typeof record?.model === "string" && record.model.trim().length > 0
        ? record.model
        : undefined;

    return {
      response: normalizeResponse(body, request, context),
      metadata: {
        upstreamStatus: response.status,
        upstreamRequestId: upstreamRequestId ?? null,
      },
      route: {
        ...(actualModel === undefined ? {} : { actualModel }),
        ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
      },
    };
  }
}
