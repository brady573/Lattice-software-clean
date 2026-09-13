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

const solandraConversationOutputSchema = z.object({
  mode: z.literal("CONVERSATION"),
  response: z.string().min(1).max(16_000),
}).strict();

const solandraGovernedOutputSchema = z.object({
  mode: z.literal("GOVERNED"),
  projection: solandraSemanticProposalSchema,
}).strict();

const solandraCognitionOutputSchema = z.discriminatedUnion("mode", [
  solandraConversationOutputSchema,
  solandraGovernedOutputSchema,
]);

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

export interface SolandraConversationContextTurn {
  readonly role: "USER" | "SOLANDRA";
  readonly content: string;
}

export interface SolandraCognitionInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly message: string;
  readonly currentObjective?: string;
  readonly recentUserMessages: readonly string[];
  readonly recentConversation?: readonly SolandraConversationContextTurn[];
  readonly governedKnowledge: readonly SolandraGovernedKnowledgeContext[];
  readonly governedRecommendations?: readonly SolandraGovernedRecommendationContext[];
}

export type SolandraCognitionResult =
  | Readonly<{
    mode: "CONVERSATION";
    response: string;
    invocationProvenance: ModelInvocationProvenance;
  }>
  | Readonly<{
    /** Omitted by legacy injected runtimes; absence means the governed path. */
    mode?: "GOVERNED";
    proposal: SolandraSemanticProposal;
    invocationProvenance: ModelInvocationProvenance;
  }>;

export interface SolandraCognitiveRuntime {
  interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult>;
}

export function isConversationalCognition(
  result: SolandraCognitionResult,
): result is Extract<SolandraCognitionResult, { mode: "CONVERSATION" }> {
  return result.mode === "CONVERSATION";
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra cognition returned malformed JSON.",
      { cause: error },
    );
  }
}

function conversationContext(input: SolandraCognitionInput): string {
  const turns = input.recentConversation
    ?? input.recentUserMessages.map((content) => ({ role: "USER" as const, content }));
  const bounded = turns.slice(-12);
  if (bounded.length === 0) return "No prior conversational turns are available.";
  return bounded.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
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

  const governedShape = JSON.stringify({
    mode: "GOVERNED",
    projection: {
      objectiveRelation: "NEW_OBJECTIVE|CONTINUE|CORRECTION",
      proposedObjective: "string or null",
      requestedHelp: "KNOWLEDGE|EXPLAIN_REFERENCE|SIMPLIFY_REFERENCE|SOURCES_REFERENCE|FRESH_RESEARCH|DECISION|EXPLAIN_RECOMMENDATION|SOURCES_RECOMMENDATION|EXPLAIN_OPTION|ACCEPT_CHOICE|RESOURCE",
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
    },
  });

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra, the conversational cognitive surface of Lattice.",
          "Understand the user's message naturally using the bounded conversation context. Handle ordinary coreference, ellipsis, corrections, topic changes, returns to prior topics, negation, hypotheticals, multiple requests, and response-style preferences as normal language rather than as keyword commands.",
          "Interpretation is not truth. Your ordinary conversational prose is useful model output, but it is not canonical USER intent, governed Knowledge, a Recommendation, USER choice, authorization, execution proof, or verification.",
          "Use CONVERSATION for ordinary discussion, explanation, brainstorming, transformation of USER material, hypothetical reasoning, or other non-consequential conversation that does not materially require a Lattice trust boundary. Answer the USER directly and naturally in response.",
          "A conversational answer may contain ordinary explanatory prose. Do not claim that conversational prose is verified or governed Knowledge. Do not add repetitive authority warnings unless they are useful to the USER's request.",
          "Use GOVERNED only when the current request materially requires a framework trust boundary: establishing or refreshing trustworthy external factual Knowledge; exact historical Knowledge provenance or transformation; a durable Recommendation or exact option/choice reference; material meaning that must enter Intent Integrity for downstream governed work; or preparation of a governed resource/action boundary.",
          "Do not route to governed Knowledge merely because an ordinary answer could contain factual language. Use it when factual establishment, freshness, sourcing, or downstream reliance materially matters.",
          "When mode is CONVERSATION, return exactly JSON {\"mode\":\"CONVERSATION\",\"response\":\"natural response\"} and no other fields.",
          "When mode is GOVERNED, do not answer the user's factual question in projection. Project only the minimum structure required by the existing Lattice boundary.",
          "For a governed projection, classify objectiveRelation by comparing the Current USER message with the Current canonical objective. Being in the same Conversation or sharing generic words is not evidence that the USER is continuing the same objective.",
          "Use NEW_OBJECTIVE when governed downstream work would target a materially different question, task, goal, or decision. Use CONTINUE when the current governed request materially depends on the current objective or supplied governed context. Use CORRECTION when the USER revises the meaning of the same governed objective.",
          "For CORRECTION, use the exact Current USER message as proposedObjective when that message itself fully represents the corrected objective. If corrected meaning requires material reconstruction, propose it and let Lattice require USER confirmation.",
          "Use materialAmbiguity only when uncertainty could materially change governed downstream work. Ask the minimum question needed; do not treat unfamiliar surface tokens as inherently ambiguous.",
          "Use SOURCES_REFERENCE, EXPLAIN_REFERENCE, or SIMPLIFY_REFERENCE only for an existing supplied Knowledge object; referencedKnowledgeId must exactly match a supplied Knowledge ID or be null when material ambiguity must be surfaced.",
          "Use FRESH_RESEARCH or KNOWLEDGE when new or externally established factual Knowledge is materially needed. knowledgeNeeds describe what must be learned, not provider search queries.",
          "Use DECISION when a durable governed Recommendation boundary is materially needed for choosing. General conversational advice does not automatically require it.",
          "Use EXPLAIN_RECOMMENDATION or SOURCES_RECOMMENDATION only for a supplied historical Recommendation. Use EXPLAIN_OPTION or ACCEPT_CHOICE only when an exact supplied option identity matters. Never invent object IDs.",
          "Use RESOURCE only when the request needs the existing governed preparation boundary. Ordinary rewriting or drafting from USER material can remain conversational when no governed resource/action boundary is needed.",
          "Return exactly one JSON object and no prose outside it.",
          "The GOVERNED shape is:",
          governedShape,
          "When materialAmbiguity is absent, return null. Use empty arrays for empty lists and null for absent references.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Conversation ID: ${input.conversationId}`,
          `Current canonical objective: ${input.currentObjective ?? "none"}`,
          "Bounded conversation context (oldest to newest):",
          conversationContext(input),
          "",
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
    temperature: 0.2,
    maxOutputTokens: 1_600,
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

function validateGovernedProjection(
  proposal: SolandraSemanticProposal,
  input: SolandraCognitionInput,
): void {
  if (proposal.requestedHelp === "COGNITIVE_ASSISTANCE") {
    throw new ModelProviderError(
      "invalid_output",
      "Canonical Solandra conversation must use CONVERSATION instead of projecting ordinary cognition into a governed help taxonomy.",
    );
  }
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
      "A referential Solandra projection must identify supplied Knowledge or surface ambiguity.",
    );
  }
  const recommendationById = new Map(
    (input.governedRecommendations ?? []).map((item) => [item.recommendationId, item] as const),
  );
  const referencedRecommendationId = proposal.referencedRecommendationId ?? null;
  if (referencedRecommendationId !== null && !recommendationById.has(referencedRecommendationId)) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra cognition referenced a Recommendation that was not supplied by Lattice.",
    );
  }
  if (recommendationReferenceHelp(proposal.requestedHelp) && referencedRecommendationId === null && proposal.materialAmbiguity === null) {
    throw new ModelProviderError(
      "invalid_output",
      "A Recommendation reference projection must identify supplied Recommendation or surface ambiguity.",
    );
  }
  const referencedOptionId = proposal.referencedOptionId ?? null;
  if (referencedOptionId !== null) {
    const referencedRecommendation = referencedRecommendationId === null
      ? undefined
      : recommendationById.get(referencedRecommendationId);
    if (!referencedRecommendation?.options.some((option) => option.optionId === referencedOptionId)) {
      throw new ModelProviderError(
        "invalid_output",
        "Solandra cognition referenced an option that Lattice did not supply for the referenced Recommendation.",
      );
    }
  }
  if ((proposal.requestedHelp === "EXPLAIN_OPTION" || proposal.requestedHelp === "ACCEPT_CHOICE") && proposal.materialAmbiguity === null) {
    if (referencedRecommendationId === null || referencedOptionId === null) {
      throw new ModelProviderError("invalid_output", "An option reference projection must identify supplied Recommendation and option or surface ambiguity.");
    }
  }
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
      throw new ModelProviderError("invalid_output", "Solandra cognition requires exactly one text output.");
    }
    const parsed = solandraCognitionOutputSchema.parse(parseJsonObject(result.response.output[0].text));
    if (parsed.mode === "CONVERSATION") {
      return Object.freeze({
        mode: "CONVERSATION" as const,
        response: parsed.response.trim(),
        invocationProvenance: result.audit.invocationProvenance,
      });
    }
    validateGovernedProjection(parsed.projection, input);
    return Object.freeze({
      mode: "GOVERNED" as const,
      proposal: parsed.projection,
      invocationProvenance: result.audit.invocationProvenance,
    });
  }
}
