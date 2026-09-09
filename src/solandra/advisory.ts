import { createHash } from "node:crypto";
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
  basis: z.array(advisoryBasisSchema).max(16),
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

const groundingAuditSchema = z.object({
  status: z.enum(["GROUNDED", "NEEDS_KNOWLEDGE"]),
  unsupportedExternalPremises: z.array(z.string().min(1).max(1_000)).max(16),
  knowledgeNeeds: z.array(z.string().min(1).max(1_000)).max(16),
}).strict().superRefine((value, context) => {
  if (value.status === "GROUNDED" && (value.unsupportedExternalPremises.length > 0 || value.knowledgeNeeds.length > 0)) {
    context.addIssue({ code: "custom", message: "A grounded advisory audit cannot report unsupported external premises." });
  }
  if (value.status === "NEEDS_KNOWLEDGE" && value.knowledgeNeeds.length === 0) {
    context.addIssue({ code: "custom", path: ["knowledgeNeeds"], message: "Unsupported factual premises require a concrete Knowledge need." });
  }
});

type GroundingAudit = z.infer<typeof groundingAuditSchema>;

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

function normalizeSingleExtraTrailingArrayBracket(text: string): unknown | undefined {
  if (!text.startsWith("[") || !text.endsWith("]]")) return undefined;
  const candidate = text.slice(0, -1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (
    !Array.isArray(parsed)
    || parsed.length !== 1
    || parsed[0] === null
    || typeof parsed[0] !== "object"
    || Array.isArray(parsed[0])
  ) {
    return undefined;
  }
  return parsed;
}

function parseJsonObject(text: string, label = "Solandra advisory reasoning"): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (error) {
    const repaired = normalizeSingleExtraTrailingArrayBracket(unfenced);
    if (repaired === undefined) {
      throw new ModelProviderError("invalid_output", `${label} returned malformed JSON.`, { cause: error });
    }
    parsed = repaired;
  }
  if (!Array.isArray(parsed)) return parsed;
  if (
    parsed.length === 1
    && parsed[0] !== null
    && typeof parsed[0] === "object"
    && !Array.isArray(parsed[0])
  ) {
    return parsed[0];
  }
  throw new ModelProviderError(
    "invalid_output",
    `${label} must return exactly one JSON object.`,
  );
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

  const contract = JSON.stringify([
    {
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
    { status: "NEEDS_KNOWLEDGE", knowledgeNeeds: ["external fact needed"], reason: "why it is required" },
    { status: "NEEDS_CLARIFICATION", question: "material USER clarification", reason: "why it changes the advice" },
    { status: "INSUFFICIENT_BASIS", reason: "why no responsible recommendation is supported", uncertainties: ["material uncertainty"] },
  ]);

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra's advisory reasoning boundary. Provide decision support over authoritative USER intent and governed Knowledge supplied by Lattice.",
          "You are non-authoritative. You may compare, evaluate tradeoffs, expose assumptions and uncertainty, recommend, or decline to recommend.",
          "Do not create or modify canonical USER intent. Do not establish new factual Knowledge. Do not authorize a selection or action. Do not claim execution occurred.",
          "Every factual basis reference must use only supplied Knowledge IDs and claim IDs. If no external factual premise is needed, a Recommendation may use an empty Knowledge basis and reason only from authoritative USER intent/current USER context. If an external fact is required but not supplied, return NEEDS_KNOWLEDGE instead of inventing it.",
          "Do not make supplied uncertainty disappear. For RECOMMENDATION, copy every material supplied uncertainty that affects the recommendation verbatim into preservedUncertainties, and explain it naturally in uncertainties when useful.",
          "Return exactly one top-level JSON object and no prose.",
          "The top-level object itself must contain status with exactly one of: RECOMMENDATION, NEEDS_KNOWLEDGE, NEEDS_CLARIFICATION, INSUFFICIENT_BASIS.",
          "Do not wrap the result in a named property such as recommendation, needsKnowledge, needsClarification, or insufficientBasis.",
          "Choose exactly one of these top-level object shapes:",
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

function buildGroundingAuditRequest(
  model: string,
  input: SolandraAdvisoryInput,
  recommendation: SolandraRecommendationResult,
): CanonicalModelRequest {
  const governedFindings = input.knowledge.flatMap((knowledge) =>
    knowledge.findings.map((finding) => ({
      knowledgeId: knowledge.knowledgeId,
      claimId: finding.claimId,
      text: finding.text,
      status: finding.status,
      confidence: finding.confidence,
    })));
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are a bounded grounding verifier for Solandra advisory output. Do not redo the recommendation and do not expose hidden reasoning.",
          "Distinguish externally factual premises from advisory judgment, comparison, preference-sensitive inference, conditional advice, and explicit USER-authored context.",
          "An externally factual premise is permitted only when it is materially supported by the supplied governed findings. USER objectives/preferences are authoritative USER context, not external factual Knowledge.",
          "If any advisory field introduces an externally factual premise that is not materially supported by the supplied governed findings, return NEEDS_KNOWLEDGE and identify the missing factual information needed. Do not repair or rewrite the advisory text.",
          "If every externally factual premise is grounded, return GROUNDED. Advisory inference does not need to be a literal restatement of a finding.",
          "Return exactly JSON with keys status, unsupportedExternalPremises, knowledgeNeeds and no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          authoritativeObjective: input.authoritativeObjective,
          authoritativeIntent: input.authoritativeIntent.state,
          userContext: input.userContext,
          governedFindings,
          advisory: {
            recommendation: recommendation.recommendation,
            rationale: recommendation.rationale,
            tradeoffs: recommendation.tradeoffs,
            assumptions: recommendation.assumptions,
            uncertainties: recommendation.uncertainties,
            alternatives: recommendation.alternatives,
          },
        }),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_200,
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

function advisoryBasisDigest(input: SolandraAdvisoryInput): string {
  return createHash("sha256")
    .update([
      input.authoritativeIntent.intentVersionId,
      ...input.knowledge.map((item) => item.knowledgeId).sort(),
    ].join("\u001f"))
    .digest("hex")
    .slice(0, 24);
}

function needsKnowledgeFromAudit(audit: GroundingAudit): Extract<SolandraAdvisoryResult, { status: "NEEDS_KNOWLEDGE" }> | undefined {
  if (audit.status === "GROUNDED") return undefined;
  const knowledgeNeeds = [...new Set(audit.knowledgeNeeds.map((item) => item.trim()).filter(Boolean))];
  if (knowledgeNeeds.length === 0) {
    throw new ModelProviderError("invalid_output", "Advisory grounding audit reported unsupported factual premises without a Knowledge need.");
  }
  return {
    status: "NEEDS_KNOWLEDGE",
    knowledgeNeeds,
    reason: audit.unsupportedExternalPremises.length > 0
      ? `The draft recommendation relied on external factual premises that are not established by governed Knowledge: ${audit.unsupportedExternalPremises.join("; ")}`
      : "The draft recommendation requires additional governed factual Knowledge before it can be presented responsibly.",
  };
}

export class ModelSolandraAdvisoryRuntime implements SolandraAdvisoryRuntime {
  constructor(
    private readonly runtime: ModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra advisory model must be non-empty.");
  }

  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    const basisDigest = advisoryBasisDigest(input);
    const response = await this.runtime.call(buildAdvisoryRequest(this.model, input), {
      correlationId: `solandra-advisory:${input.conversationId}:${input.userMessageId}`,
      idempotencyKey: `advise:${input.userMessageId}:${basisDigest}`,
      maxAttempts: 1,
    });
    if (response.response.output.length !== 1 || response.response.output[0]?.type !== "text") {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning requires exactly one text output.");
    }
    const result = solandraAdvisoryResultSchema.parse(parseJsonObject(response.response.output[0].text));
    if (result.status !== "RECOMMENDATION") {
      return Object.freeze({ result, invocationProvenance: response.audit.invocationProvenance });
    }

    validateRecommendationBasis(input, result);
    const auditResponse = await this.runtime.call(buildGroundingAuditRequest(this.model, input, result), {
      correlationId: `solandra-advisory-grounding:${input.conversationId}:${input.userMessageId}`,
      idempotencyKey: `grounding:${input.userMessageId}:${basisDigest}`,
      maxAttempts: 1,
    });
    if (auditResponse.response.output.length !== 1 || auditResponse.response.output[0]?.type !== "text") {
      throw new ModelProviderError("invalid_output", "Solandra advisory grounding verification requires exactly one text output.");
    }
    const audit = groundingAuditSchema.parse(parseJsonObject(
      auditResponse.response.output[0].text,
      "Solandra advisory grounding verification",
    ));
    const needsKnowledge = needsKnowledgeFromAudit(audit);
    return Object.freeze({
      result: needsKnowledge ?? result,
      invocationProvenance: response.audit.invocationProvenance,
    });
  }
}
