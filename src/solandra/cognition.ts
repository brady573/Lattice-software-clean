import { z } from "zod";
import { ModelProviderError } from "../model/errors.js";
import { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../model/types.js";

export const solandraRequestedHelpSchema = z.enum([
  "KNOWLEDGE",
  "EXPLAIN_REFERENCE",
  "SIMPLIFY_REFERENCE",
  "SOURCES_REFERENCE",
  "FRESH_RESEARCH",
  "DECISION",
  "EXPLAIN_RECOMMENDATION",
  "SOURCES_RECOMMENDATION",
  "EXPLAIN_OPTION",
  "ACCEPT_CHOICE",
  "COGNITIVE_ASSISTANCE",
  "RESOURCE",
]);
export type SolandraRequestedHelp = z.infer<typeof solandraRequestedHelpSchema>;

export const solandraObjectiveRelationSchema = z.enum([
  "NEW_OBJECTIVE",
  "CONTINUE",
  "CORRECTION",
]);
export type SolandraObjectiveRelation = z.infer<typeof solandraObjectiveRelationSchema>;

const materialAmbiguitySchema = z.object({
  question: z.string().min(1).max(1_000),
  couldChangeObjective: z.boolean(),
}).strict();

export const solandraSemanticProposalSchema = z.object({
  objectiveRelation: solandraObjectiveRelationSchema,
  proposedObjective: z.string().min(1).max(8_000).nullable(),
  requestedHelp: solandraRequestedHelpSchema,
  relevantContext: z.array(z.string().min(1).max(1_000)).max(16),
  entities: z.array(z.string().min(1).max(300)).max(24),
  referents: z.array(z.string().min(1).max(300)).max(16),
  constraints: z.array(z.string().min(1).max(500)).max(16),
  preferences: z.array(z.string().min(1).max(500)).max(16),
  knowledgeNeeds: z.array(z.string().min(1).max(1_000)).max(16),
  materialAmbiguity: materialAmbiguitySchema.nullable(),
  referencedKnowledgeId: z.string().min(1).max(128).nullable(),
  referencedRecommendationId: z.string().min(1).max(128).nullable().optional(),
  referencedOptionId: z.string().min(1).max(128).nullable().optional(),
  /**
   * Compatibility-only inert metadata from early M1 proposals. Product behavior
   * is classified by requestedHelp; this value has no intent, truth, routing,
   * decision, or authorization authority and is no longer requested from models.
   */
  proposedNextStep: z.string().min(1).max(100).optional(),
}).strict();
export type SolandraSemanticProposal = z.infer<typeof solandraSemanticProposalSchema>;

export interface SolandraGovernedKnowledgeContext {
  readonly knowledgeId: string;
  readonly objective: string;
  readonly findings: readonly Readonly<{
    claimId: string;
    text: string;
    status: string;
  }>[];
  readonly sourceCount: number;
  readonly uncertainties: readonly string[];
}

export interface SolandraGovernedRecommendationContext {
  readonly recommendationId: string;
  readonly recommendation: string;
  readonly intentVersionId: string;
  readonly knowledgeIds: readonly string[];
  readonly createdAt: string;
  readonly options: readonly Readonly<{ optionId: string; position: number; text: string; recommended: boolean }>[];
}

export interface SolandraCognitionInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly message: string;
  readonly currentObjective?: string;
  readonly recentUserMessages: readonly string[];
  readonly governedKnowledge: readonly SolandraGovernedKnowledgeContext[];
  readonly governedRecommendations?: readonly SolandraGovernedRecommendationContext[];
}

export interface SolandraCognitionResult {
  readonly proposal: SolandraSemanticProposal;
  readonly invocationProvenance: ModelInvocationProvenance;
}

export interface SolandraCognitiveRuntime {
  interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult>;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra cognition returned malformed semantic JSON.",
      { cause: error },
    );
  }
}

function buildCognitionRequest(model: string, input: SolandraCognitionInput): CanonicalModelRequest {
  const knowledge = input.governedKnowledge.length === 0
    ? "No prior governed Knowledge is addressable in this conversation."
    : input.governedKnowledge.map((item) => [
      `Knowledge ID: ${item.knowledgeId}`,
      `Objective: ${item.objective}`,
      `Findings: ${item.findings.map((finding) => `[${finding.claimId}] ${finding.status}: ${finding.text}`).join(" | ") || "none"}`,
      `Source count: ${item.sourceCount}`,
      `Uncertainties: ${item.uncertainties.join(" | ") || "none"}`,
    ].join("\n")).join("\n\n");

  const recommendations = (input.governedRecommendations ?? []).length === 0
    ? "No prior governed Recommendation is addressable in this conversation."
    : (input.governedRecommendations ?? []).map((item) => [
      `Recommendation ID: ${item.recommendationId}`,
      `Recommendation: ${item.recommendation}`,
      `IntentVersion ID: ${item.intentVersionId}`,
      `Knowledge IDs: ${item.knowledgeIds.join(" | ") || "none"}`,
      `Created at: ${item.createdAt}`,
      `Options: ${item.options.map((option) => `[${option.optionId}] position=${option.position} recommended=${option.recommended}: ${option.text}`).join(" | ") || "none"}`,
    ].join("\n")).join("\n\n");

  const schemaExample = JSON.stringify({
    objectiveRelation: "NEW_OBJECTIVE|CONTINUE|CORRECTION",
    proposedObjective: "string or null",
    requestedHelp: "KNOWLEDGE|EXPLAIN_REFERENCE|SIMPLIFY_REFERENCE|SOURCES_REFERENCE|FRESH_RESEARCH|DECISION|EXPLAIN_RECOMMENDATION|SOURCES_RECOMMENDATION|EXPLAIN_OPTION|ACCEPT_CHOICE|COGNITIVE_ASSISTANCE|RESOURCE",
    relevantContext: ["string"],
    entities: ["string"],
    referents: ["string"],
    constraints: ["string"],
    preferences: ["string"],
    knowledgeNeeds: ["string"],
    materialAmbiguity: { question: "string", couldChangeObjective: true },
    referencedKnowledgeId: "one supplied Knowledge ID or null",
    referencedRecommendationId: "one supplied Recommendation ID or null",
    referencedOptionId: "one supplied option ID or null",
  });

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra's semantic cognition boundary. Understand the user's conversational request and return a non-authoritative proposal only.",
          "Do not answer the factual question. Do not establish truth, canonical intent, a recommendation, authorization, or action.",
          "Canonical USER intent is written elsewhere. Your proposedObjective is advisory and must never be treated as USER-authored merely because you generated it.",
          "Classify objectiveRelation by the semantic relationship between the CURRENT USER message and the current canonical objective, not merely because both occur in the same Conversation.",
          "The Current USER message field is the turn being classified. If that same text also appears in Recent USER messages, treat the duplicate only as conversation context; repetition there is not evidence that the turn CONTINUEs the prior objective.",
          "Use NEW_OBJECTIVE when the current message independently asks for a materially different topic, outcome, task, or decision from the current objective. An abrupt but clear topic change is NEW_OBJECTIVE even when prior messages remain visible in the same Conversation.",
          "Use CONTINUE when the current message is a same-objective follow-up, elaboration, request for explanation/sources/simplification, or contextual continuation whose meaning materially depends on the current objective or supplied governed state.",
          "Use CORRECTION when the USER is revising, retracting, narrowing, expanding, or otherwise correcting the meaning of the current objective. Do not use CORRECTION merely because the USER starts an unrelated objective.",
          "When it is materially unclear whether the current message continues the current objective or starts a different one, preserve the current objective provisionally: return objectiveRelation CONTINUE, proposedObjective null, and ask the minimum necessary question in materialAmbiguity. Do not guess a new objective through ambiguity.",
          "For a clear NEW_OBJECTIVE, do not let recent conversation history or the prior canonical objective make the old topic sticky. Set materialAmbiguity to null unless a real unresolved ambiguity could materially change the work.",
          "Use materialAmbiguity only when uncertainty could materially change the objective or requested work. Do not treat acronyms, technical tokens, or unfamiliar terms as ambiguous merely because of their surface form when context makes the request clear.",
          "Use SOURCES_REFERENCE, EXPLAIN_REFERENCE, or SIMPLIFY_REFERENCE when the user clearly refers to an existing supplied Knowledge object. referencedKnowledgeId must be exactly one supplied Knowledge ID or null.",
          "Use FRESH_RESEARCH only when the user asks for new, updated, additional, or otherwise external Knowledge beyond the supplied object. A historical provenance request is not fresh research.",
          "Use DECISION only when the user is actually asking for help choosing/deciding, not merely asking for differences or information.",
          "Use EXPLAIN_RECOMMENDATION when the user asks why a supplied historical Recommendation was made. Use SOURCES_RECOMMENDATION when the user asks for the evidence/sources behind it. referencedRecommendationId must be exactly one supplied Recommendation ID or null.",
          "Use EXPLAIN_OPTION when the user refers conversationally to one exact supplied option and asks about it without choosing it. Use ACCEPT_CHOICE only when the USER actually chooses one supplied option and exact choice identity matters. For either, return both its exact supplied Recommendation ID and option ID. Resolve references from context and supplied option identity, not from a phrase-specific command. If the intended option is materially ambiguous, ask a precise clarification instead of guessing.",
          "Use COGNITIVE_ASSISTANCE for bounded non-consequential help such as brainstorming, analyzing USER-authored material, rewriting, or transforming material when the request does not require new factual Knowledge, a governed Recommendation, a formal Decision, or Action Preparation.",
          "COGNITIVE_ASSISTANCE is only a request for a capability. It does not itself authorize that capability and it does not turn generated content into Knowledge.",
          "requestedHelp is the sole classification of the requested work. Do not add a separate next-step or workflow field.",
          "Return exactly one JSON object and no prose. The required shape is:",
          schemaExample,
          "When materialAmbiguity is absent, return null for it. Use empty arrays when a list has no items.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Conversation ID: ${input.conversationId}`,
          `Current canonical objective: ${input.currentObjective ?? "none"}`,
          `Recent USER messages: ${input.recentUserMessages.join(" | ") || "none"}`,
          "Addressable governed Knowledge:",
          knowledge,
          "",
          "Addressable governed Recommendations:",
          recommendations,
          "",
          `Current USER message: ${input.message}`,
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_200,
    seed: 0,
  };
}

function referenceHelp(help: SolandraRequestedHelp): boolean {
  return help === "SOURCES_REFERENCE"
    || help === "EXPLAIN_REFERENCE"
    || help === "SIMPLIFY_REFERENCE";
}

function recommendationReferenceHelp(help: SolandraRequestedHelp): boolean {
  return help === "EXPLAIN_RECOMMENDATION" || help === "SOURCES_RECOMMENDATION";
}

export class ModelSolandraCognitiveRuntime implements SolandraCognitiveRuntime {
  constructor(
    private readonly runtime: ModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra cognition model must be non-empty.");
  }

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const request = buildCognitionRequest(this.model, input);
    const result = await this.runtime.call(request, {
      correlationId: `solandra-cognition:${input.conversationId}:${input.messageId}`,
      idempotencyKey: input.messageId,
      maxAttempts: 1,
    });
    if (result.response.output.length !== 1 || result.response.output[0]?.type !== "text") {
      throw new ModelProviderError("invalid_output", "Solandra cognition requires exactly one semantic text output.");
    }
    const proposal = solandraSemanticProposalSchema.parse(parseJsonObject(result.response.output[0].text));
    const allowedKnowledgeIds = new Set(input.governedKnowledge.map((item) => item.knowledgeId));
    if (proposal.referencedKnowledgeId !== null && !allowedKnowledgeIds.has(proposal.referencedKnowledgeId)) {
      throw new ModelProviderError(
        "invalid_output",
        "Solandra cognition referenced Knowledge that was not supplied by Lattice.",
      );
    }
    if (referenceHelp(proposal.requestedHelp) && proposal.referencedKnowledgeId === null && proposal.materialAmbiguity === null) {
      throw new ModelProviderError(
        "invalid_output",
        "A referential Solandra proposal must identify supplied Knowledge or surface ambiguity.",
      );
    }
    const allowedRecommendationIds = new Set((input.governedRecommendations ?? []).map((item) => item.recommendationId));
    const referencedRecommendationId = proposal.referencedRecommendationId ?? null;
    if (referencedRecommendationId !== null && !allowedRecommendationIds.has(referencedRecommendationId)) {
      throw new ModelProviderError(
        "invalid_output",
        "Solandra cognition referenced a Recommendation that was not supplied by Lattice.",
      );
    }
    if (recommendationReferenceHelp(proposal.requestedHelp) && referencedRecommendationId === null && proposal.materialAmbiguity === null) {
      throw new ModelProviderError(
        "invalid_output",
        "A Recommendation reference proposal must identify supplied Recommendation or surface ambiguity.",
      );
    }
    const optionToRecommendation = new Map<string, string>();
    for (const recommendation of input.governedRecommendations ?? []) {
      for (const option of recommendation.options) optionToRecommendation.set(option.optionId, recommendation.recommendationId);
    }
    const referencedOptionId = proposal.referencedOptionId ?? null;
    if (referencedOptionId !== null && !optionToRecommendation.has(referencedOptionId)) {
      throw new ModelProviderError("invalid_output", "Solandra cognition referenced an option that Lattice did not supply.");
    }
    if ((proposal.requestedHelp === "EXPLAIN_OPTION" || proposal.requestedHelp === "ACCEPT_CHOICE") && proposal.materialAmbiguity === null) {
      if (referencedRecommendationId === null || referencedOptionId === null) {
        throw new ModelProviderError("invalid_output", "An option reference proposal must identify supplied Recommendation and option or surface ambiguity.");
      }
      if (optionToRecommendation.get(referencedOptionId) !== referencedRecommendationId) {
        throw new ModelProviderError("invalid_output", "Solandra cognition bound an option to the wrong Recommendation.");
      }
    }
    return Object.freeze({
      proposal,
      invocationProvenance: result.audit.invocationProvenance,
    });
  }
}
