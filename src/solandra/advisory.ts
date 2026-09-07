import { z } from "zod";
import type { IntentVersion } from "../intent/types.js";
import { ModelProviderError } from "../model/errors.js";
import { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../model/types.js";

const advisoryBasisSchema = z.object({
  knowledgeId: z.string().min(1).max(128),
  claimIds: z.array(z.string().min(1).max(200)).min(1).max(64),
}).strict();
export type SolandraAdvisoryBasis = z.infer<typeof advisoryBasisSchema>;

const recommendationSchema = z.object({
  status: z.literal("RECOMMENDATION"),
  recommendation: z.string().min(1).max(8_000),
  basis: z.array(advisoryBasisSchema).min(1).max(16),
  rationale: z.array(z.string().min(1).max(2_000)).min(1).max(16),
  tradeoffs: z.array(z.string().min(1).max(2_000)).max(16),
  assumptions: z.array(z.string().min(1).max(2_000)).max(16),
  uncertainties: z.array(z.string().min(1).max(2_000)).max(16),
  preservedUncertainties: z.array(z.string().min(1).max(2_000)).max(32),
  alternatives: z.array(z.string().min(1).max(2_000)).max(16),
}).strict();

const needsKnowledgeSchema = z.object({
  status: z.literal("NEEDS_KNOWLEDGE"),
  knowledgeNeeds: z.array(z.string().min(1).max(1_000)).min(1).max(16),
  reason: z.string().min(1).max(2_000),
}).strict();

const needsClarificationSchema = z.object({
  status: z.literal("NEEDS_CLARIFICATION"),
  question: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(2_000),
}).strict();

const insufficientBasisSchema = z.object({
  status: z.literal("INSUFFICIENT_BASIS"),
  reason: z.string().min(1).max(2_000),
  uncertainties: z.array(z.string().min(1).max(2_000)).max(16),
}).strict();

export const solandraAdvisoryResultSchema = z.discriminatedUnion("status", [
  recommendationSchema,
  needsKnowledgeSchema,
  needsClarificationSchema,
  insufficientBasisSchema,
]);
export type SolandraAdvisoryResult = z.infer<typeof solandraAdvisoryResultSchema>;
export type SolandraRecommendationResult = Extract<SolandraAdvisoryResult, { status: "RECOMMENDATION" }>;

export interface SolandraAdvisoryKnowledge {
  readonly knowledgeId: string;
  readonly objective: string;
  readonly findings: readonly Readonly<{
    claimId: string;
    text: string;
    status: string;
    confidence: string;
  }>[];
  readonly uncertainties: readonly string[];
  readonly asOf: string;
}

export interface SolandraAdvisoryInput {
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly authoritativeIntent: IntentVersion;
  readonly authoritativeObjective: string;
  readonly userContext: readonly string[];
  readonly knowledge: readonly SolandraAdvisoryKnowledge[];
}

export interface SolandraAdvisoryRuntimeResult {
  readonly result: SolandraAdvisoryResult;
  readonly invocationProvenance: ModelInvocationProvenance;
}

export interface SolandraAdvisoryRuntime {
  advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult>;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError("invalid_output", "Solandra advisory reasoning returned malformed JSON.", { cause: error });
  }
}

function buildAdvisoryRequest(model: string, input: SolandraAdvisoryInput): CanonicalModelRequest {
  const knowledge = input.knowledge.length === 0
    ? "No governed Knowledge was supplied."
    : input.knowledge.map((item) => [
      `Knowledge ID: ${item.knowledgeId}`,
      `Objective: ${item.objective}`,
      `As of: ${item.asOf}`,
      `Findings: ${item.findings.map((finding) => `[${finding.claimId}] ${finding.status}/${finding.confidence}: ${finding.text}`).join(" | ") || "none"}`,
      `Uncertainties: ${item.uncertainties.join(" | ") || "none"}`,
    ].join("\n")).join("\n\n");

  const contract = JSON.stringify({
    recommendation: {
      status: "RECOMMENDATION",
      recommendation: "string",
      basis: [{ knowledgeId: "one supplied Knowledge ID", claimIds: ["supplied claim IDs from that Knowledge"] }],
      rationale: ["concise advisory reason"],
      tradeoffs: ["material tradeoff"],
      assumptions: ["material assumption"],
      uncertainties: ["plain-language uncertainty"],
      preservedUncertainties: ["copy each material supplied uncertainty used by the recommendation verbatim"],
      alternatives: ["relevant alternative"],
    },
    needsKnowledge: { status: "NEEDS_KNOWLEDGE", knowledgeNeeds: ["external fact needed"], reason: "why it is required" },
    needsClarification: { status: "NEEDS_CLARIFICATION", question: "material USER clarification", reason: "why it changes the advice" },
    insufficientBasis: { status: "INSUFFICIENT_BASIS", reason: "why no responsible recommendation is supported", uncertainties: ["material uncertainty"] },
  });

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra's advisory reasoning boundary. Provide decision support over authoritative USER intent and governed Knowledge supplied by Lattice.",
          "You are non-authoritative. You may compare, evaluate tradeoffs, expose assumptions and uncertainty, recommend, or decline to recommend.",
          "Do not create or modify canonical USER intent. Do not establish new factual Knowledge. Do not authorize a selection or action. Do not claim execution occurred.",
          "Every factual basis reference must use only supplied Knowledge IDs and claim IDs. If an external fact is required but not supplied, return NEEDS_KNOWLEDGE instead of inventing it.",
          "Do not make supplied uncertainty disappear. For RECOMMENDATION, copy every material supplied uncertainty that affects the recommendation verbatim into preservedUncertainties, and explain it naturally in uncertainties when useful.",
          "Return one JSON object and no prose. Use exactly one of these shapes:",
          contract,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Conversation ID: ${input.conversationId}`,
          `Exact authoritative IntentVersion ID: ${input.authoritativeIntent.intentVersionId}`,
          `Authoritative USER objective: ${input.authoritativeObjective}`,
          `Authoritative intent state: ${JSON.stringify(input.authoritativeIntent.state)}`,
          `Current USER context: ${input.userContext.join(" | ") || "none"}`,
          "Governed Knowledge:",
          knowledge,
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 2_000,
    seed: 0,
  };
}

function validateRecommendationBasis(input: SolandraAdvisoryInput, result: SolandraRecommendationResult): void {
  const supplied = new Map(input.knowledge.map((knowledge) => [
    knowledge.knowledgeId,
    {
      claimIds: new Set(knowledge.findings.map((finding) => finding.claimId)),
      uncertainties: new Set(knowledge.uncertainties),
    },
  ]));
  const usedUncertainties = new Set<string>();

  for (const basis of result.basis) {
    const knowledge = supplied.get(basis.knowledgeId);
    if (!knowledge) {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning referenced Knowledge that Lattice did not supply.");
    }
    for (const claimId of basis.claimIds) {
      if (!knowledge.claimIds.has(claimId)) {
        throw new ModelProviderError("invalid_output", "Solandra advisory reasoning referenced a claim that is not part of the supplied Knowledge.");
      }
    }
    for (const uncertainty of knowledge.uncertainties) usedUncertainties.add(uncertainty);
  }

  const preserved = new Set(result.preservedUncertainties);
  for (const uncertainty of preserved) {
    if (!usedUncertainties.has(uncertainty)) {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning invented an uncertainty reference that was not supplied by Lattice.");
    }
  }
  for (const uncertainty of usedUncertainties) {
    if (!preserved.has(uncertainty)) {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning dropped material governed uncertainty from its recommendation basis.");
    }
  }
}

export class ModelSolandraAdvisoryRuntime implements SolandraAdvisoryRuntime {
  constructor(
    private readonly runtime: ModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra advisory model must be non-empty.");
  }

  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    const response = await this.runtime.call(buildAdvisoryRequest(this.model, input), {
      correlationId: `solandra-advisory:${input.conversationId}:${input.userMessageId}`,
      idempotencyKey: input.userMessageId,
      maxAttempts: 1,
    });
    if (response.response.output.length !== 1 || response.response.output[0]?.type !== "text") {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning requires exactly one text output.");
    }
    const result = solandraAdvisoryResultSchema.parse(parseJsonObject(response.response.output[0].text));
    if (result.status === "RECOMMENDATION") validateRecommendationBasis(input, result);
    return Object.freeze({ result, invocationProvenance: response.audit.invocationProvenance });
  }
}
