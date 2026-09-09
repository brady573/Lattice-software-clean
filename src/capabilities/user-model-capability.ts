import { z } from "zod";
import type { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest } from "../model/types.js";
import type { CapabilityContract, CapabilityExecutionContext } from "./contracts.js";

export const USER_AUTHORIZED_MODEL_CAPABILITY_ID = "user-authorized-cognitive-model" as const;

export const userModelPurposeSchema = z.enum([
  "GENERAL_COGNITIVE_ASSISTANCE",
  "ANALYZE_USER_MATERIAL",
  "DRAFT_FROM_USER_MATERIAL",
  "BRAINSTORM",
  "TRANSFORM_USER_MATERIAL",
]);
export type UserModelPurpose = z.infer<typeof userModelPurposeSchema>;

export const userModelInputSchema = z.object({
  purpose: userModelPurposeSchema,
  instruction: z.string().min(1).max(8_000),
  userContext: z.array(z.string().min(1).max(2_000)).max(12).default([]),
  // Public callers cannot assert governed Knowledge. Empty compatibility input is
  // accepted so older clients do not gain a truth-labeling surface by omission.
  governedKnowledge: z.array(z.never()).max(0).optional(),
}).strict();
export type UserModelInput = z.infer<typeof userModelInputSchema>;

export interface UserModelOutput {
  readonly text: string;
  readonly authority: "NON_AUTHORITATIVE_PROPOSAL";
  readonly factualTreatment: "REQUIRES_KNOWLEDGE_TRUST";
}

function requestFor(model: string, input: UserModelInput): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are a user-authorized cognitive capability used by Solandra for bounded non-consequential work.",
          "Your output is proposed cognitive work only. It is not canonical USER intent, Knowledge, a Recommendation, USER choice, authorization, execution, or verification.",
          "Do not claim that an external factual premise is established merely because you generated it. Factual claims require Lattice Knowledge Trust before Product adoption.",
          "Use only the bounded USER-authored context supplied below. No governed Knowledge is supplied through this capability input.",
          "Do not request credentials, provider details, hidden system state, or the full conversation graph.",
          `Purpose: ${input.purpose}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Instruction: ${input.instruction}`,
          `USER-authored context: ${input.userContext.join(" | ") || "none"}`,
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_200,
    seed: 0,
  };
}

export class UserAuthorizedModelCapability implements CapabilityContract<UserModelInput, UserModelOutput> {
  readonly id = USER_AUTHORIZED_MODEL_CAPABILITY_ID;
  readonly description = "USER-authorized bounded cognitive model work for Solandra.";
  readonly authorizationRequirement = "EXPLICIT_SUBJECT_GRANT" as const;
  readonly effect = "COGNITIVE_ONLY" as const;
  readonly trustHandling = "NON_AUTHORITATIVE_PROPOSAL" as const;
  readonly inputContract = "purpose + instruction + bounded USER-authored context; caller-supplied governed Knowledge is rejected";
  readonly outputContract = "bounded non-authoritative text proposal + sanitized capability provenance";

  constructor(private readonly runtime: ModelRuntime, private readonly model: string) {
    if (!model.trim()) throw new Error("User-authorized model capability requires a non-empty model identity.");
  }

  async invoke(rawInput: UserModelInput, context: CapabilityExecutionContext) {
    const input = userModelInputSchema.parse(rawInput);
    const result = await this.runtime.call(requestFor(this.model, input), {
      correlationId: `user-model:${context.subjectId}:${context.requestId}`,
      idempotencyKey: context.requestId,
      maxAttempts: 1,
    });
    if (result.response.output.length !== 1 || result.response.output[0]?.type !== "text") {
      throw new Error("User-authorized model capability requires exactly one text output.");
    }
    const text = result.response.output[0].text.trim();
    if (!text) throw new Error("User-authorized model capability returned blank output.");
    return Object.freeze({
      output: Object.freeze({
        text,
        authority: "NON_AUTHORITATIVE_PROPOSAL" as const,
        factualTreatment: "REQUIRES_KNOWLEDGE_TRUST" as const,
      }),
      provenance: Object.freeze({
        kind: "MODEL" as const,
        source: "MODEL_RUNTIME" as const,
        ...result.audit.invocationProvenance,
      }),
    });
  }
}
