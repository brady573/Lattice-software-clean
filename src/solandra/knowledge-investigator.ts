import { z } from "zod";
import type {
  KnowledgeInvestigator,
  KnowledgeInvestigationPlan,
  KnowledgeInvestigationPlanningInput,
  KnowledgeResponsivenessInput,
  KnowledgeResponsivenessResult,
} from "../knowledge/investigation.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../model/groq-knowledge-simplifier.js";
import { LocalOfflineModelRuntime } from "../model/local-offline-runtime.js";
import { ModelProviderError } from "../model/errors.js";
import { OpenAiCompatibleModelProvider } from "../model/openai-compatible.js";
import type { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest } from "../model/types.js";
import type { RuntimeConfig } from "../runtime-config.js";

const MAX_RETRIEVAL_QUERIES = 8;
const MAX_SOURCE_PREVIEW_CHARS = 6_000;

const investigationPlanSchema = z.object({
  retrievalQueries: z.array(z.string().min(1).max(1_000)).min(1).max(MAX_RETRIEVAL_QUERIES),
}).strict();

const responsivenessSchema = z.object({
  selections: z.array(z.object({
    claimId: z.string().min(1).max(300),
    sourceIds: z.array(z.string().min(1).max(300)).min(1).max(16),
  }).strict()).max(64),
}).strict();

function parseJsonObject(text: string, purpose: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError("invalid_output", `Solandra ${purpose} returned malformed JSON.`, { cause: error });
  }
}

function singleTextOutput(result: Awaited<ReturnType<ModelRuntime["call"]>>, purpose: string): string {
  if (result.response.output.length !== 1 || result.response.output[0]?.type !== "text") {
    throw new ModelProviderError("invalid_output", `Solandra ${purpose} requires exactly one text output.`);
  }
  return result.response.output[0].text;
}

function planningRequest(model: string, input: KnowledgeInvestigationPlanningInput): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra's non-authoritative Knowledge investigation cognition.",
          "Formulate provider-ready retrieval requests that give the USER's objective a materially adequate opportunity to be answered.",
          "The authoritative objective and USER work context are supplied by Lattice. Do not rewrite canonical USER intent.",
          "knowledgeNeeds describe what still needs to be learned; they are not search queries and must not be copied mechanically.",
          "Use ordinary semantic understanding to formulate concise retrieval queries. Preserve distinct material investigation needs rather than compressing them to satisfy an arbitrary query count.",
          `At most ${MAX_RETRIEVAL_QUERIES} retrieval queries can be issued in this operational call. If the work cannot be represented within that resource budget without materially losing meaning, fail rather than silently dropping material investigation needs.`,
          "Do not answer the USER, establish truth, rank source authority, make a recommendation, or authorize action.",
          "Return exactly one JSON object with shape: {\"retrievalQueries\":[\"string\"]}.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Run ID: ${input.runId}`,
          `Authoritative objective: ${input.objective}`,
          `Current work context: ${input.context.join(" | ") || "none"}`,
          `Knowledge needs: ${input.knowledgeNeeds.join(" | ") || "none explicitly proposed; infer the external information needed to answer the objective"}`,
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_000,
    seed: 0,
  };
}

function responsivenessRequest(model: string, input: KnowledgeResponsivenessInput): CanonicalModelRequest {
  const sources = input.sources.map((source) => [
    `Source ID: ${source.sourceId}`,
    `Title: ${source.title}`,
    `Publisher: ${source.publisher ?? "unknown"}`,
    `Content preview: ${source.content.slice(0, MAX_SOURCE_PREVIEW_CHARS)}`,
  ].join("\n")).join("\n\n");
  const claims = input.claims.map((claim) => [
    `Claim ID: ${claim.claimId}`,
    `Claim: ${claim.text}`,
    `Evidence source IDs: ${claim.evidence.map((item) => item.sourceId).join(" | ") || "none"}`,
  ].join("\n")).join("\n\n");

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra's non-authoritative semantic responsiveness boundary for acquired information.",
          "Select only acquired claims and their acquired evidence sources that materially respond to the USER's authoritative objective and current Knowledge work.",
          "Use semantic understanding, not lexical overlap. Materially relevant supporting, conflicting, qualifying, or explanatory information may all be responsive.",
          "Exclude information that is merely topically adjacent, shares words, or answers a different relationship or question.",
          "Do not decide whether a claim is true, verified, authoritative, sufficiently evidenced, or safe to rely on. V36 owns evidence admission and truth after this step.",
          "Every claimId and sourceId must be copied exactly from the supplied candidates. Do not invent, rewrite, merge, or synthesize claims or provenance.",
          "Return exactly one JSON object with shape: {\"selections\":[{\"claimId\":\"exact id\",\"sourceIds\":[\"exact id\"]}]}.",
          "Return an empty selections array when none of the acquired candidates materially responds to the work.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Run ID: ${input.runId}`,
          `Authoritative objective: ${input.objective}`,
          `Current work context: ${input.context.join(" | ") || "none"}`,
          `Knowledge needs: ${input.knowledgeNeeds.join(" | ") || "none explicitly proposed"}`,
          `Retrieval queries used: ${input.retrievalQueries.join(" | ")}`,
          "",
          "Acquired sources:",
          sources || "none",
          "",
          "Acquired claims:",
          claims || "none",
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_600,
    seed: 0,
  };
}

export class ModelSolandraKnowledgeInvestigator implements KnowledgeInvestigator {
  readonly kind = "solandra-semantic-investigation-v1";

  constructor(
    private readonly runtime: ModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra Knowledge investigator model must be non-empty.");
  }

  async plan(input: KnowledgeInvestigationPlanningInput): Promise<KnowledgeInvestigationPlan> {
    const result = await this.runtime.call(planningRequest(this.model, input), {
      correlationId: `solandra-investigation-plan:${input.runId}`,
      idempotencyKey: `${input.runId}:investigation-plan`,
      maxAttempts: 1,
    });
    return investigationPlanSchema.parse(parseJsonObject(
      singleTextOutput(result, "Knowledge investigation planning"),
      "Knowledge investigation planning",
    ));
  }

  async selectResponsive(input: KnowledgeResponsivenessInput): Promise<KnowledgeResponsivenessResult> {
    if (input.sources.length === 0 || input.claims.length === 0) return { selections: [] };
    const result = await this.runtime.call(responsivenessRequest(this.model, input), {
      correlationId: `solandra-responsiveness:${input.runId}`,
      idempotencyKey: `${input.runId}:responsiveness`,
      maxAttempts: 1,
    });
    return responsivenessSchema.parse(parseJsonObject(
      singleTextOutput(result, "Knowledge responsiveness"),
      "Knowledge responsiveness",
    ));
  }
}

export function createConfiguredSolandraKnowledgeInvestigator(
  config: RuntimeConfig,
): ModelSolandraKnowledgeInvestigator | undefined {
  if (config.solandraCognitionRoute === "groq-gpt-oss-120b") {
    if (!config.solandraCognitionApiKey) {
      throw new Error("Configured Solandra Knowledge investigation route is missing its runtime credential.");
    }
    const runtime = new GroqKnowledgeSimplifierModelRuntime(
      new GroqKnowledgeSimplifierModelProvider({ apiKey: config.solandraCognitionApiKey }),
    );
    return new ModelSolandraKnowledgeInvestigator(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  }

  if (config.localModelProviderBaseUrl !== undefined && config.localModelProviderModel !== undefined) {
    const runtime = new LocalOfflineModelRuntime(
      new OpenAiCompatibleModelProvider({ baseUrl: config.localModelProviderBaseUrl }),
    );
    return new ModelSolandraKnowledgeInvestigator(runtime, config.localModelProviderModel);
  }

  return undefined;
}
