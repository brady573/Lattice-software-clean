import { z } from "zod";
import { ModelProviderError } from "../model/errors.js";
import type { ModelRuntime } from "../model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelInvocationProvenance,
} from "../model/types.js";
import type { PreparedResourceBasis } from "../outcome.js";
import type { SolandraGovernedKnowledgeContext } from "./cognition.js";

export interface SolandraActionPreparationInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly intentVersionId: string;
  readonly userMessageId: string;
  readonly userMessage: string;
  readonly authoritativeObjective: string;
  readonly knowledge: readonly SolandraGovernedKnowledgeContext[];
}

export type SolandraActionPreparationResult =
  | Readonly<{
    status: "PREPARED";
    body: string;
    basis: PreparedResourceBasis[];
    preservedUncertainties: string[];
  }>
  | Readonly<{
    status: "INSUFFICIENT_BASIS" | "FIDELITY_REJECTED";
    reason: string;
  }>;

export interface SolandraActionPreparationRuntimeResult {
  readonly result: SolandraActionPreparationResult;
  readonly generationProvenance: ModelInvocationProvenance;
  readonly groundingProvenance: ModelInvocationProvenance | null;
}

export interface SolandraActionPreparer {
  prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult>;
}

type CallableModelRuntime = Pick<ModelRuntime, "call">;

const basisSchema = z.object({
  knowledgeId: z.string().min(1).max(128),
  claimIds: z.array(z.string().min(1).max(300)).min(1).max(32),
}).strict();

const generationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("PREPARED"),
    body: z.string().min(1).max(8_000),
    basis: z.array(basisSchema).max(16),
  }).strict(),
  z.object({
    status: z.literal("INSUFFICIENT_BASIS"),
    reason: z.string().min(1).max(2_000),
    body: z.null(),
    basis: z.array(basisSchema).max(0),
  }).strict(),
]);

const groundingSchema = z.object({
  status: z.enum(["GROUNDED", "UNSUPPORTED"]),
  unsupportedExternalPremises: z.array(z.string().min(1).max(2_000)).max(16),
  materialUncertaintyPreserved: z.boolean(),
  authorityBoundaryPreserved: z.boolean(),
}).strict();

function parseJsonObject(text: string, label: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_output",
      `Solandra ${label} returned malformed JSON.`,
      { cause: error },
    );
  }
}

function knowledgePrompt(knowledge: readonly SolandraGovernedKnowledgeContext[]): string {
  if (knowledge.length === 0) return "No governed Knowledge is available for this preparation.";
  return knowledge.map((item) => [
    `Knowledge ID: ${item.knowledgeId}`,
    `Knowledge objective: ${item.objective}`,
    "Governed findings:",
    ...item.findings.map((finding) =>
      `[${finding.claimId}] status=${finding.status}; text=${finding.text}`),
    `Known uncertainties: ${item.uncertainties.join(" | ") || "none"}`,
  ].join("\n")).join("\n\n");
}

function generationRequest(model: string, input: SolandraActionPreparationInput): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra preparing one editable message for the USER. This is preparation only, not authorization or execution.",
          "Write material that directly serves the USER's requested message purpose and format. Do not output a generic objective/findings wrapper.",
          "You may rely only on the exact USER-authored/current-authoritative material supplied below and on supplied governed Knowledge findings.",
          "Any governed factual finding used in the message must be listed in basis with its exact Knowledge ID and exact claim ID. Do not invent, repair, or infer IDs.",
          "Do not add names, dates, quantities, causes, events, promises, attachments, legal conclusions, outcomes, or other externally factual premises absent from the allowed material.",
          "Ordinary drafting language such as greetings, requests, questions, and thanks does not need a Knowledge basis.",
          "Preserve materially relevant uncertainty or conflict rather than converting it to certainty.",
          "Never claim that Lattice, Solandra, or the Product sent, submitted, booked, purchased, applied, executed, or authorized the message or any external action.",
          "Do not mention internal IDs, runs, providers, models, V36, workflow stages, or authorization machinery in the message body.",
          "If a useful faithful message cannot be prepared from the allowed material, return INSUFFICIENT_BASIS rather than inventing content.",
          "Return exactly one top-level JSON object and no prose.",
          "For success: {\"status\":\"PREPARED\",\"body\":\"...\",\"basis\":[{\"knowledgeId\":\"...\",\"claimIds\":[\"...\"]}]}.",
          "For failure: {\"status\":\"INSUFFICIENT_BASIS\",\"reason\":\"...\",\"body\":null,\"basis\":[]}.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Requested resource format: editable message",
          `Current authoritative USER objective: ${input.authoritativeObjective}`,
          `Current exact USER request: ${input.userMessage}`,
          "Governed Knowledge available for optional factual support:",
          knowledgePrompt(input.knowledge),
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_800,
    seed: 0,
  };
}

function groundingRequest(
  model: string,
  input: SolandraActionPreparationInput,
  body: string,
  selected: readonly SolandraGovernedKnowledgeContext[],
): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are a bounded grounding verifier for a prepared USER message. Verification is not truth authority and cannot create facts, USER intent, authorization, or execution.",
          "Check the draft only against the exact authoritative USER material and the explicitly selected governed Knowledge below.",
          "Mark UNSUPPORTED if the draft contains any externally factual premise not supported by that material. Greetings, requests, questions, preferences, and thanks are not external factual premises.",
          "materialUncertaintyPreserved is true only when any uncertainty/conflict that materially qualifies a selected finding remains faithfully represented wherever the draft relies on that finding.",
          "authorityBoundaryPreserved is false if the draft represents Lattice/Solandra as having sent, submitted, booked, purchased, applied, executed, or authorized an external action, or grants external-action permission not supplied by the USER.",
          "Return exactly JSON: {\"status\":\"GROUNDED|UNSUPPORTED\",\"unsupportedExternalPremises\":[\"...\"],\"materialUncertaintyPreserved\":boolean,\"authorityBoundaryPreserved\":boolean} and no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Prepared draft: ${body}`,
          `Current authoritative USER objective: ${input.authoritativeObjective}`,
          `Current exact USER request: ${input.userMessage}`,
          "Explicitly selected governed Knowledge basis:",
          knowledgePrompt(selected),
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 800,
    seed: 0,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function validateBasis(
  requested: readonly z.infer<typeof basisSchema>[],
  knowledge: readonly SolandraGovernedKnowledgeContext[],
): { basis: PreparedResourceBasis[]; selected: SolandraGovernedKnowledgeContext[] } | null {
  const available = new Map(knowledge.map((item) => [item.knowledgeId, item]));
  const merged = new Map<string, Set<string>>();
  for (const entry of requested) {
    const item = available.get(entry.knowledgeId);
    if (!item) return null;
    const availableClaims = new Set(item.findings.map((finding) => finding.claimId));
    const claims = merged.get(entry.knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) {
      if (!availableClaims.has(claimId)) return null;
      claims.add(claimId);
    }
    merged.set(entry.knowledgeId, claims);
  }
  const basis = [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
  const selected = basis.map((entry) => available.get(entry.knowledgeId)!).filter(Boolean);
  return { basis, selected };
}

export class ModelSolandraActionPreparer implements SolandraActionPreparer {
  constructor(
    private readonly runtime: CallableModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra Action Preparation model must be non-empty.");
  }

  async prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult> {
    const generated = await this.runtime.call(generationRequest(this.model, input), {
      correlationId: `solandra-action-prepare:${input.runId}:${input.userMessageId}`,
      idempotencyKey: `PREPARED_MESSAGE:${input.intentVersionId}:${input.userMessageId}`,
      maxAttempts: 1,
    });
    const generationProvenance = generated.audit.invocationProvenance;
    if (generated.response.output.length !== 1 || generated.response.output[0]?.type !== "text") {
      return Object.freeze({
        result: { status: "FIDELITY_REJECTED" as const, reason: "Prepared material did not return one text result." },
        generationProvenance,
        groundingProvenance: null,
      });
    }
    const parsed = generationSchema.parse(parseJsonObject(
      generated.response.output[0].text,
      "Action Preparation generation",
    ));
    if (parsed.status === "INSUFFICIENT_BASIS") {
      return Object.freeze({
        result: { status: "INSUFFICIENT_BASIS" as const, reason: parsed.reason },
        generationProvenance,
        groundingProvenance: null,
      });
    }

    const validated = validateBasis(parsed.basis, input.knowledge);
    if (!validated) {
      return Object.freeze({
        result: {
          status: "FIDELITY_REJECTED" as const,
          reason: "Prepared material referenced Knowledge or claims outside the supplied governed basis.",
        },
        generationProvenance,
        groundingProvenance: null,
      });
    }

    const grounded = await this.runtime.call(
      groundingRequest(this.model, input, parsed.body, validated.selected),
      {
        correlationId: `solandra-action-ground:${input.runId}:${input.userMessageId}`,
        idempotencyKey: `PREPARED_MESSAGE_GROUND:${input.intentVersionId}:${input.userMessageId}`,
        maxAttempts: 1,
      },
    );
    const groundingProvenance = grounded.audit.invocationProvenance;
    if (grounded.response.output.length !== 1 || grounded.response.output[0]?.type !== "text") {
      return Object.freeze({
        result: { status: "FIDELITY_REJECTED" as const, reason: "Prepared material could not be grounded faithfully." },
        generationProvenance,
        groundingProvenance,
      });
    }
    const verification = groundingSchema.parse(parseJsonObject(
      grounded.response.output[0].text,
      "Action Preparation grounding",
    ));
    if (
      verification.status !== "GROUNDED"
      || verification.unsupportedExternalPremises.length > 0
      || !verification.materialUncertaintyPreserved
      || !verification.authorityBoundaryPreserved
    ) {
      return Object.freeze({
        result: {
          status: "FIDELITY_REJECTED" as const,
          reason: "Prepared material could not be kept within the established USER/Knowledge and authority boundaries.",
        },
        generationProvenance,
        groundingProvenance,
      });
    }

    return Object.freeze({
      result: {
        status: "PREPARED" as const,
        body: parsed.body.trim(),
        basis: validated.basis,
        preservedUncertainties: unique(validated.selected.flatMap((item) => [...item.uncertainties])),
      },
      generationProvenance,
      groundingProvenance,
    });
  }
}
