import { randomUUID } from "node:crypto";
import { ModelProviderError } from "./errors.js";
import type { ModelProvider } from "./provider.js";
import type {
  CanonicalModelRequest,
  CanonicalModelToolDefinition,
  ModelCallContext,
  ModelProviderResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_PENDING_JOBS = 16;

export interface AndroidRelayJob {
  readonly jobId: string;
  readonly correlationId: string;
  readonly request: unknown;
}

export interface AndroidRelayCompletion {
  readonly statusCode: number;
  readonly bodyText: string;
}

export type AndroidRelayTransition =
  | "completed"
  | "failed"
  | "not_found"
  | "not_claimed";

interface PendingRelayJob {
  readonly job: AndroidRelayJob;
  claimed: boolean;
  readonly complete: (completion: AndroidRelayCompletion) => void;
  readonly fail: () => void;
}

export interface AndroidRelayModelProviderOptions {
  readonly timeoutMs?: number;
  readonly maxPendingJobs?: number;
  readonly idFactory?: () => string;
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
    chat_template_kwargs: { enable_thinking: false },
    ...(request.tools === undefined ? {} : { tools: request.tools.map(toOpenAiTool) }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.seed === undefined ? {} : { seed: request.seed }),
  };
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
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) return undefined;
  return { inputTokens, outputTokens };
}

function normalizeOpenAiResponse(
  body: unknown,
  request: CanonicalModelRequest,
  context: ModelCallContext,
): unknown {
  const record = asRecord(body);
  const choices = record === null ? null : record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelProviderError(
      "invalid_output",
      "Android model response did not contain a choice.",
      { statusCode: 502 },
    );
  }
  const firstChoice = asRecord(choices[0]);
  const message = firstChoice === null ? null : asRecord(firstChoice.message);
  if (message === null) {
    throw new ModelProviderError(
      "invalid_output",
      "Android model response did not contain an assistant message.",
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
          "Android model tool call was malformed.",
          { statusCode: 502 },
        );
      }
      let args: unknown;
      try {
        args = JSON.parse(fn.arguments);
      } catch (error) {
        throw new ModelProviderError(
          "invalid_output",
          "Android model tool arguments were not valid JSON.",
          { statusCode: 502, cause: error },
        );
      }
      output.push({ type: "tool_call", id: call.id, name: fn.name, arguments: args });
    }
  }

  if (output.length === 0) {
    throw new ModelProviderError(
      "invalid_output",
      "Android model response contained no licensed output.",
      { statusCode: 502 },
    );
  }

  const id = record !== null && typeof record.id === "string" && record.id.trim().length > 0
    ? record.id
    : `model-${context.requestIdentity.slice(0, 16)}-${context.attempt}`;
  const model = record !== null && typeof record.model === "string" && record.model.trim().length > 0
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

function parseProviderBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new ModelProviderError(
      "malformed_response",
      "Android model worker returned malformed provider JSON.",
      { statusCode: 502, cause: error },
    );
  }
}

function requireSuccessfulStatus(statusCode: number): void {
  if (statusCode >= 200 && statusCode < 300) return;
  if (statusCode === 429) {
    throw new ModelProviderError(
      "rate_limit",
      "Android model endpoint rate limited the request.",
      { retryable: true, statusCode },
    );
  }
  throw new ModelProviderError(
    "unavailable",
    `Android model endpoint returned HTTP ${statusCode}.`,
    {
      retryable: statusCode >= 500,
      statusCode,
    },
  );
}

export class AndroidRelayModelProvider implements ModelProvider {
  readonly kind = "android-relay-openai-compatible";
  private readonly timeoutMs: number;
  private readonly maxPendingJobs: number;
  private readonly idFactory: () => string;
  private readonly pending = new Map<string, PendingRelayJob>();
  private readonly queue: string[] = [];

  constructor(options: AndroidRelayModelProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 115_000) {
      throw new Error("Android relay timeoutMs must be an integer between 1000 and 115000.");
    }
    this.maxPendingJobs = options.maxPendingJobs ?? DEFAULT_MAX_PENDING_JOBS;
    if (!Number.isSafeInteger(this.maxPendingJobs) || this.maxPendingJobs < 1 || this.maxPendingJobs > 256) {
      throw new Error("Android relay maxPendingJobs must be an integer between 1 and 256.");
    }
    this.idFactory = options.idFactory ?? (() => `android-model-${randomUUID()}`);
  }

  async generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    if (context.signal.aborted) {
      throw new ModelProviderError("cancelled", "Android relay request was cancelled before dispatch.");
    }
    if (this.pending.size >= this.maxPendingJobs) {
      throw new ModelProviderError(
        "rate_limit",
        "Android relay reached its bounded pending-job capacity.",
        { retryable: true, statusCode: 429 },
      );
    }

    const jobId = this.idFactory();
    if (jobId.trim().length === 0 || this.pending.has(jobId)) {
      throw new Error("Android relay job IDs must be unique and non-empty.");
    }

    return await new Promise<ModelProviderResult>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);
        this.pending.delete(jobId);
        const queuedIndex = this.queue.indexOf(jobId);
        if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onAbort = () => {
        settle(() => reject(new ModelProviderError(
          "cancelled",
          "Android relay request was cancelled.",
          { cause: context.signal.reason },
        )));
      };

      timer = setTimeout(() => {
        settle(() => reject(new ModelProviderError(
          "timeout",
          "Android model worker did not complete the request before the relay timeout.",
          { retryable: true },
        )));
      }, this.timeoutMs);

      const pending: PendingRelayJob = {
        job: Object.freeze({
          jobId,
          correlationId: context.correlationId,
          request: toOpenAiRequest(request),
        }),
        claimed: false,
        complete: (completion) => {
          settle(() => {
            try {
              requireSuccessfulStatus(completion.statusCode);
              const body = parseProviderBody(completion.bodyText);
              resolve({
                response: normalizeOpenAiResponse(body, request, context),
                metadata: {
                  relayJobId: jobId,
                  upstreamStatus: completion.statusCode,
                },
              });
            } catch (error) {
              reject(error);
            }
          });
        },
        fail: () => {
          settle(() => reject(new ModelProviderError(
            "unavailable",
            "Android model worker could not reach its local inference endpoint.",
            { retryable: true },
          )));
        },
      };

      this.pending.set(jobId, pending);
      this.queue.push(jobId);
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    });
  }

  claimNext(): AndroidRelayJob | undefined {
    while (this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (jobId === undefined) return undefined;
      const pending = this.pending.get(jobId);
      if (pending === undefined || pending.claimed) continue;
      pending.claimed = true;
      return pending.job;
    }
    return undefined;
  }

  complete(jobId: string, completion: AndroidRelayCompletion): AndroidRelayTransition {
    const pending = this.pending.get(jobId);
    if (pending === undefined) return "not_found";
    if (!pending.claimed) return "not_claimed";
    pending.complete(completion);
    return "completed";
  }

  fail(jobId: string): AndroidRelayTransition {
    const pending = this.pending.get(jobId);
    if (pending === undefined) return "not_found";
    if (!pending.claimed) return "not_claimed";
    pending.fail();
    return "failed";
  }

  status(): Readonly<{ queued: number; claimed: number }> {
    let queued = 0;
    let claimed = 0;
    for (const pending of this.pending.values()) {
      if (pending.claimed) claimed += 1;
      else queued += 1;
    }
    return Object.freeze({ queued, claimed });
  }

  close(): void {
    for (const pending of [...this.pending.values()]) {
      pending.fail();
    }
    this.queue.length = 0;
  }
}
