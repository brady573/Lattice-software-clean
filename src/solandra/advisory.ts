import { createHash } from "node:crypto";
import { z } from "zod";
import type { IntentVersion } from "../intent/types.js";
import { ModelProviderError } from "../model/errors.js";
import { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../model/types.js";
import type { SolandraSemanticProposal } from "./cognition.js";

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
  userPremiseMessageIds: z.array(z.string().min(1).max(200)).min(1).max(12).optional(),
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

type GroundingFinding = Readonly<{
  knowledgeId: string;
  claimId: string;
  text: string;
  status: string;
  confidence: string;
}>;

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

export interface SolandraAdvisoryUserContextMessage {
  readonly messageId: string;
  readonly content: string;
}

/**
 * Bounded current-turn cognition supplied only as a reasoning aid.
 * It deliberately excludes governed object references, capability selection,
 * ambiguity/Knowledge routing, and every durable authority field.
 */
export type SolandraAdvisoryTransientCognition = Readonly<{
  objectiveRelation: SolandraSemanticProposal["objectiveRelation"];
  proposedObjective: SolandraSemanticProposal["proposedObjective"];
  relevantContext: readonly string[];
  entities: readonly string[];
  referents: readonly string[];
  constraints: readonly string[];
  preferences: readonly string[];
}>;

export function projectAdvisoryTransientCognition(
  proposal: SolandraSemanticProposal,
): SolandraAdvisoryTransientCognition {
  return Object.freeze({
    objectiveRelation: proposal.objectiveRelation,
    proposedObjective: proposal.proposedObjective,
    relevantContext: Object.freeze([...proposal.relevantContext]),
    entities: Object.freeze([...proposal.entities]),
    referents: Object.freeze([...proposal.referents]),
    constraints: Object.freeze([...proposal.constraints]),
    preferences: Object.freeze([...proposal.preferences]),
  });
}

export interface SolandraAdvisoryInput {
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly authoritativeIntent: IntentVersion;
  readonly authoritativeObjective: string;
  readonly userContext: readonly string[];
  /**
   * Exact USER-authored source messages available to this advisory call.
   * These are context, not reconstructed canonical Intent.
   */
  readonly userContextMessages?: readonly SolandraAdvisoryUserContextMessage[];
  /**
   * Non-authoritative interpretation already produced by Solandra cognition
   * for this exact turn. This helps advisory avoid repeating ordinary language
   * reconstruction and never becomes USER premise or governed authority.
   */
  readonly transientCognition?: SolandraAdvisoryTransientCognition;
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
      recommendation: "concise advisory proposal or option; not factual support",
      basis: [{ knowledgeId: "one supplied Knowledge ID", claimIds: ["supplied claim IDs from that Knowledge"] }],
      rationale: ["advisory judgment only; never durable factual support"],
      tradeoffs: ["advisory tradeoff only; never durable factual support"],
      assumptions: ["exact verbatim USER-supplied premise excerpt, if useful"],
      uncertainties: ["drafting explanation of uncertainty; never factual authority"],
      preservedUncertainties: ["copy each material supplied uncertainty used by the recommendation verbatim"],
      alternatives: ["other concise advisory proposal or option"],
      ...(input.userContextMessages
        ? { userPremiseMessageIds: ["exact supplied USER message IDs materially relied upon, including the current USER message ID"] }
        : {}),
    },
    { status: "NEEDS_KNOWLEDGE", knowledgeNeeds: ["external fact needed"], reason: "why it is required" },
    { status: "NEEDS_CLARIFICATION", question: "material USER ambiguity that prevents responsible advice", reason: "why it changes the advice" },
    { status: "INSUFFICIENT_BASIS", reason: "why no responsible recommendation is supported", uncertainties: ["material uncertainty"] },
  ]);

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra's advisory reasoning boundary. Provide decision support over authoritative USER intent and governed Knowledge supplied by Lattice.",
          "You are non-authoritative. You may formulate options, compare, evaluate tradeoffs, expose assumptions and uncertainty, recommend, or decline to recommend.",
          "Do not create or modify canonical USER intent. Do not establish new factual Knowledge. Do not authorize a selection or action. Do not claim execution occurred.",
          "For RECOMMENDATION, recommendation and alternatives are concise advisory proposals. You may originate them when the USER states a decision goal or preferences without already supplying candidate options. Do not return NEEDS_CLARIFICATION merely because the USER did not pre-author the option you would recommend.",
          "Keep recommendation and alternatives as option/proposal text rather than factual support: do not append external factual rationale, source claims, or claims of established performance to those fields. USER-supplied options may be reused naturally when present.",
          "assumptions may contain only exact verbatim excerpts of USER-authored material. Lattice independently rechecks these excerpts and discards anything that is not exact USER material.",
          "When exact USER context message IDs are supplied, every RECOMMENDATION must return userPremiseMessageIds. Include the current USER message ID and only additional supplied USER message IDs whose exact material the recommendation materially relies upon. Do not invent IDs and do not carry unrelated prior-topic messages into premise authority. When exact USER context message IDs are not supplied, omit userPremiseMessageIds.",
          "The supplied exact USER context is conversational premise material only. It does not make model reconstruction canonical USER Intent.",
          "Transient Solandra cognition, when supplied, is the already-produced current-turn interpretation of ordinary conversational meaning. Use it as a reasoning aid for reference, coreference, ellipsis, shorthand, and contextual preferences instead of rediscovering that meaning from raw transcript alone.",
          "Transient Solandra cognition is explicitly non-authoritative and may not establish or modify canonical USER Intent, USER premise authority, Knowledge, governed object identity, USER choice, authorization, execution, verification, or factual provenance. Durable USER premises must still come only from exact supplied USER message IDs and verbatim USER material.",
          "If transient cognition conflicts with exact USER-authored context or authoritative Intent state, do not promote the transient interpretation into authority.",
          "Every external factual basis reference must use only supplied Knowledge IDs and claim IDs. Lattice renders factual support later from those exact governed claims; recommendation, alternatives, rationale, tradeoffs, assumptions, and uncertainties never establish factual support or source provenance.",
          "If no external factual premise is needed, a Recommendation may use an empty Knowledge basis and reason only from authoritative USER intent/current USER context. If an external fact is genuinely required but not supplied, return NEEDS_KNOWLEDGE instead of inventing it.",
          "Use NEEDS_CLARIFICATION only for genuine USER ambiguity that materially prevents responsible advice, not for missing pre-authored candidate options.",
          "Do not make supplied uncertainty disappear. For RECOMMENDATION, copy every material supplied uncertainty that affects the recommendation verbatim into preservedUncertainties. Any natural-language uncertainty explanation is drafting material only; Lattice persists governed uncertainty, not generated uncertainty prose.",
          "rationale and tradeoffs are transient drafting/advisory judgment only. They are not durable Recommendation factual support.",
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
          `Current USER message ID: ${input.userMessageId}`,
          `Exact USER-authored context messages (oldest to newest): ${input.userContextMessages ? JSON.stringify(input.userContextMessages) : JSON.stringify(input.userContext)}`,
          `Transient non-authoritative Solandra cognition for this turn: ${JSON.stringify(input.transientCognition ?? null)}`,
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
  governedFindings: readonly GroundingFinding[],
): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are a bounded grounding verifier for Solandra advisory output. Do not redo the recommendation and do not expose hidden reasoning.",
          "Distinguish externally factual premises from advisory judgment, comparison, preference-sensitive inference, conditional advice, generated option proposals, and explicit USER-authored context.",
          "An externally factual premise is permitted only when it is materially supported by the supplied governed findings. USER objectives/preferences are authoritative USER context, not external factual Knowledge.",
          "If any advisory field introduces an externally factual premise that is not materially supported by the supplied governed findings, return NEEDS_KNOWLEDGE and identify the missing factual information needed. Do not repair or rewrite the advisory text.",
          "If every externally factual premise is grounded, return GROUNDED. Advisory inference and option formulation do not need to be literal restatements of findings or USER wording.",
          "This audit is only a drafting guardrail. GROUNDED does not grant factual authority. Lattice independently constructs durable factual support from exact governed Knowledge/claim basis. Recommendation and alternative proposal text may persist only as non-authoritative advisory judgment and never becomes source-backed factual support.",
          "Return exactly JSON with keys status, unsupportedExternalPremises, knowledgeNeeds and no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          authoritativeObjective: input.authoritativeObjective,
          authoritativeIntent: input.authoritativeIntent.state,
          userContext: input.userContextMessages ?? input.userContext,
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

function validateAndProjectRecommendationBasis(
  input: SolandraAdvisoryInput,
  result: SolandraRecommendationResult,
): GroundingFinding[] {
  const supplied = new Map(input.knowledge.map((knowledge) => [
    knowledge.knowledgeId,
    {
      findings: new Map(knowledge.findings.map((finding) => [finding.claimId, finding])),
      uncertainties: new Set(knowledge.uncertainties),
    },
  ]));
  const usedUncertainties = new Set<string>();
  const governedFindings: GroundingFinding[] = [];

  for (const basis of result.basis) {
    const knowledge = supplied.get(basis.knowledgeId);
    if (!knowledge) {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning referenced Knowledge that Lattice did not supply.");
    }
    for (const claimId of basis.claimIds) {
      const finding = knowledge.findings.get(claimId);
      if (!finding) {
        throw new ModelProviderError("invalid_output", "Solandra advisory reasoning referenced a claim that is not part of the supplied Knowledge.");
      }
      governedFindings.push({
        knowledgeId: basis.knowledgeId,
        claimId: finding.claimId,
        text: finding.text,
        status: finding.status,
        confidence: finding.confidence,
      });
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

  return governedFindings;
}

function validateRecommendationUserPremises(
  input: SolandraAdvisoryInput,
  result: SolandraRecommendationResult,
): void {
  const supplied = input.userContextMessages;
  if (supplied === undefined) {
    if (result.userPremiseMessageIds !== undefined) {
      throw new ModelProviderError(
        "invalid_output",
        "Solandra advisory reasoning referenced USER premise message IDs that Lattice did not supply.",
      );
    }
    return;
  }
  if (supplied.length === 0) {
    throw new Error("Structured advisory USER context must include the current exact USER source message.");
  }
  const suppliedIds = supplied.map((message) => message.messageId);
  if (new Set(suppliedIds).size !== suppliedIds.length || !suppliedIds.includes(input.userMessageId)) {
    throw new Error("Structured advisory USER context has invalid exact source-message identity.");
  }
  const premiseIds = result.userPremiseMessageIds;
  if (!premiseIds || premiseIds.length === 0) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra advisory Recommendation omitted exact USER premise message lineage.",
    );
  }
  if (new Set(premiseIds).size !== premiseIds.length) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra advisory Recommendation duplicated USER premise message lineage.",
    );
  }
  if (!premiseIds.includes(input.userMessageId)) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra advisory Recommendation dropped the current USER source message from premise lineage.",
    );
  }
  const suppliedSet = new Set(suppliedIds);
  if (premiseIds.some((messageId) => !suppliedSet.has(messageId))) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra advisory Recommendation referenced USER premise material that Lattice did not supply.",
    );
  }
}

function advisoryBasisDigest(input: SolandraAdvisoryInput): string {
  const userContextIdentity = input.userContextMessages
    ? input.userContextMessages.flatMap((message) => [message.messageId, message.content])
    : [...input.userContext];
  return createHash("sha256")
    .update([
      input.authoritativeIntent.intentVersionId,
      ...userContextIdentity,
      JSON.stringify(input.transientCognition ?? null),
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
      maxAttempts: 2,
    });
    if (response.response.output.length !== 1 || response.response.output[0]?.type !== "text") {
      throw new ModelProviderError("invalid_output", "Solandra advisory reasoning requires exactly one text output.");
    }
    const result = solandraAdvisoryResultSchema.parse(parseJsonObject(response.response.output[0].text));
    if (result.status !== "RECOMMENDATION") {
      return Object.freeze({ result, invocationProvenance: response.audit.invocationProvenance });
    }

    validateRecommendationUserPremises(input, result);
    const governedFindings = validateAndProjectRecommendationBasis(input, result);
    const auditResponse = await this.runtime.call(
      buildGroundingAuditRequest(this.model, input, result, governedFindings),
      {
        correlationId: `solandra-advisory-grounding:${input.conversationId}:${input.userMessageId}`,
        idempotencyKey: `grounding:${input.userMessageId}:${basisDigest}`,
        maxAttempts: 2,
      },
    );
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
