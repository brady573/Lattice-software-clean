import { performance } from "node:perf_hooks";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL,
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
} from "../src/model/groq-knowledge-simplifier.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

const CANONICAL_SHA = "13d0a0c5e3be760dc8f2929a6e80587d06caa7e3";
const USER_WORDING = "I'm deciding whether to move to a smaller apartment to reduce monthly costs, but I work from home and need a quiet dedicated workspace. Help me think through the tradeoffs before I decide.";
const CEILING_MS = 120_000;
const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error("GROQ_API_KEY is unavailable to the validator workflow.");

let observation = null;

function safeErrorBody(root) {
  const error = root && typeof root === "object" && !Array.isArray(root) ? root.error : null;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const clean = {};
  for (const key of ["type", "code", "message"]) {
    const value = error[key];
    if (typeof value === "string" || typeof value === "number") {
      clean[key] = typeof value === "string" ? value.slice(0, 1000) : value;
    }
  }
  return clean;
}

function classify({ validCompletion, elapsedMs, httpStatus, ceilingExceeded, transportFailure }) {
  if (validCompletion) {
    if (elapsedMs <= 30_000) return "LONGER_CEILING_DOES_NOT_EXPLAIN_PRODUCT_TIMEOUT";
    if (elapsedMs <= 60_000) return "CURRENT_PRODUCT_ATTEMPT_WINDOW_MISMATCH_EVIDENCED";
    return "EXTREME_PROVIDER_LATENCY_EVIDENCED";
  }
  if (httpStatus === 429) return "PROVIDER_RATE_LIMIT_EVIDENCED";
  if (httpStatus !== null && httpStatus >= 500) return "PROVIDER_UNAVAILABILITY_EVIDENCED";
  if (ceilingExceeded) return "PROVIDER_NONRESPONSE_BEYOND_PRODUCT_WINDOWS_EVIDENCED";
  if (transportFailure) return "DISCRIMINATOR_INVALID";
  return "DISCRIMINATOR_INVALID";
}

const directRuntime = {
  async call(request, options) {
    const controller = new AbortController();
    const ceilingTimer = setTimeout(
      () => controller.abort(new Error("measurement ceiling exceeded")),
      CEILING_MS,
    );
    const startedAt = new Date();
    const started = performance.now();
    let httpStatus = null;
    let root = null;
    let responseText = "";
    let transportFailure = null;
    try {
      const response = await fetch(`${GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL}/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
          "x-lattice-correlation-id": options.correlationId,
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
        }),
        signal: controller.signal,
      });
      httpStatus = response.status;
      responseText = await response.text();
      try {
        root = JSON.parse(responseText);
      } catch {
        root = null;
      }

      const endedAt = new Date();
      const elapsedMs = Math.round(performance.now() - started);
      const choice = root && Array.isArray(root.choices) && root.choices.length === 1
        ? root.choices[0]
        : null;
      const content = choice?.message && typeof choice.message.content === "string"
        ? choice.message.content.trim()
        : "";
      const responseModel = root && typeof root.model === "string" ? root.model.trim() : null;
      const requestId = root && typeof root.id === "string" ? root.id.trim() : null;
      const finishReason = choice && typeof choice.finish_reason === "string"
        ? choice.finish_reason
        : null;
      const usage = root && root.usage && typeof root.usage === "object" && !Array.isArray(root.usage)
        ? {
            prompt_tokens: Number.isSafeInteger(root.usage.prompt_tokens) ? root.usage.prompt_tokens : null,
            completion_tokens: Number.isSafeInteger(root.usage.completion_tokens) ? root.usage.completion_tokens : null,
            total_tokens: Number.isSafeInteger(root.usage.total_tokens) ? root.usage.total_tokens : null,
          }
        : null;
      const validProviderCompletion =
        response.ok
        && responseModel === GROQ_KNOWLEDGE_SIMPLIFIER_MODEL
        && choice !== null
        && content.length > 0;

      observation = {
        canonical_sha: CANONICAL_SHA,
        provider: "Groq",
        endpoint: `${GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL}/chat/completions`,
        model_requested: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        user_equivalent_wording: USER_WORDING,
        parameters: {
          temperature: request.temperature ?? 0,
          reasoning_effort: "low",
          max_completion_tokens: request.maxOutputTokens ?? null,
          seed: request.seed ?? null,
          tools: "none",
          retries: 0,
        },
        measurement_ceiling_ms: CEILING_MS,
        request_start_timestamp: startedAt.toISOString(),
        response_or_failure_timestamp: endedAt.toISOString(),
        elapsed_ms: elapsedMs,
        http_status: httpStatus,
        request_id: requestId,
        response_model: responseModel,
        finish_reason: finishReason,
        token_usage: usage,
        provider_completion_structurally_valid: validProviderCompletion,
        valid_non_empty_completion: false,
        provider_error: response.ok ? null : safeErrorBody(root),
        ceiling_exceeded: false,
        transport_failure: null,
        cognition_validation_error: null,
        classification: null,
      };

      if (!response.ok || !validProviderCompletion) {
        observation.classification = classify({
          validCompletion: false,
          elapsedMs,
          httpStatus,
          ceilingExceeded: false,
          transportFailure: false,
        });
        throw new Error("measurement did not yield a structurally valid provider completion");
      }

      return {
        response: {
          id: requestId ?? "validator-direct-groq",
          model: responseModel,
          output: [{ type: "text", text: content }],
        },
        audit: {
          correlationId: options.correlationId,
          requestIdentity: "validator-direct-groq",
          providerKind: "groq",
          attempt: 0,
          elapsedMs,
          providerMetadata: {},
          invocationProvenance: {
            executionClass: "LIVE_DIRECT",
            routeMode: "PINNED",
            requestedProvider: "groq",
            requestedModel: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
            actualProvider: "groq",
            actualModel: responseModel,
            brokerIdentity: null,
            brokerVersion: null,
            upstreamRequestId: requestId,
            routeProvenance: "COMPLETE",
          },
        },
      };
    } catch (error) {
      if (observation === null) {
        const endedAt = new Date();
        const elapsedMs = Math.round(performance.now() - started);
        const ceilingExceeded = controller.signal.aborted;
        transportFailure = error instanceof Error ? error.name + ": " + error.message : String(error);
        observation = {
          canonical_sha: CANONICAL_SHA,
          provider: "Groq",
          endpoint: `${GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL}/chat/completions`,
          model_requested: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
          user_equivalent_wording: USER_WORDING,
          parameters: {
            temperature: request.temperature ?? 0,
            reasoning_effort: "low",
            max_completion_tokens: request.maxOutputTokens ?? null,
            seed: request.seed ?? null,
            tools: "none",
            retries: 0,
          },
          measurement_ceiling_ms: CEILING_MS,
          request_start_timestamp: startedAt.toISOString(),
          response_or_failure_timestamp: endedAt.toISOString(),
          elapsed_ms: elapsedMs,
          http_status: httpStatus,
          request_id: null,
          response_model: null,
          finish_reason: null,
          token_usage: null,
          provider_completion_structurally_valid: false,
          valid_non_empty_completion: false,
          provider_error: null,
          ceiling_exceeded: ceilingExceeded,
          transport_failure: ceilingExceeded ? "measurement ceiling exceeded" : transportFailure,
          cognition_validation_error: null,
          classification: classify({
            validCompletion: false,
            elapsedMs,
            httpStatus,
            ceilingExceeded,
            transportFailure: !ceilingExceeded,
          }),
        };
      }
      throw error;
    } finally {
      clearTimeout(ceilingTimer);
    }
  },
};

const cognition = new ModelSolandraCognitiveRuntime(
  directRuntime,
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  1,
);

try {
  await cognition.interpret({
    conversationId: "validator-long-ceiling-conversation",
    messageId: "validator-long-ceiling-message",
    message: USER_WORDING,
    recentUserMessages: [],
    governedKnowledge: [],
    governedRecommendations: [],
  });
  observation.valid_non_empty_completion = true;
  observation.classification = classify({
    validCompletion: true,
    elapsedMs: observation.elapsed_ms,
    httpStatus: observation.http_status,
    ceilingExceeded: false,
    transportFailure: false,
  });
} catch (error) {
  if (
    observation
    && observation.provider_completion_structurally_valid
    && observation.http_status >= 200
    && observation.http_status < 300
  ) {
    observation.cognition_validation_error =
      error instanceof Error ? error.name + ": " + error.message : String(error);
    observation.valid_non_empty_completion = false;
    observation.classification = "DISCRIMINATOR_INVALID";
  }
}

console.log("VALIDATOR_GROQ_DISCRIMINATOR_JSON=" + JSON.stringify(observation));
