import { z } from "zod";
import { ModelProviderError } from "../model/errors.js";
import { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../model/types.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../outcome.js";
import { validateKnowledgeSimplification } from "../presentation/solandra/knowledge-simplification.js";

export type SolandraKnowledgePresentationMode = "EXPLAIN" | "SIMPLIFY";

export interface SolandraKnowledgePresentationInput {
  readonly knowledgeId: string;
  readonly userMessageId: string;
  readonly mode: SolandraKnowledgePresentationMode;
  readonly knowledge: KnowledgeOutcome;
}

export type SolandraKnowledgePresentationResult =
  | Readonly<{
    status: "PRESENTED";
    text: string;
    invocationProvenance: ModelInvocationProvenance;
  }>
  | Readonly<{
    status: "NEEDS_NEW_KNOWLEDGE";
    text: null;
    invocationProvenance: ModelInvocationProvenance;
  }>
  | Readonly<{
    status: "FIDELITY_REJECTED";
    text: null;
    invocationProvenance: ModelInvocationProvenance;
  }>;

export interface SolandraKnowledgePresenter {
  present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult>;
}

const presentationOutputSchema = z.object({
  needsNewKnowledge: z.boolean(),
  segments: z.array(z.object({
    claimId: z.string().min(1).max(300),
    text: z.string().min(1).max(2_000),
  }).strict()).max(16),
}).strict();

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_output",
      "Solandra Knowledge presentation returned malformed JSON.",
      { cause: error },
    );
  }
}

function buildRequest(
  model: string,
  input: SolandraKnowledgePresentationInput,
): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra presenting an already-governed Lattice Knowledge object. Presentation is not Knowledge authority.",
          "Use only the supplied findings. Do not add facts, examples, causes, consequences, quantities, dates, recommendations, source claims, or certainty absent from them.",
          "If the requested explanation would require any externally factual claim not present in the findings, set needsNewKnowledge=true and return no segments.",
          "Otherwise return one or more claim-bound segments. Each claimId must exactly match a supplied finding. A segment may restate that finding in clearer ordinary language but may not change its material meaning.",
          "Do not mention internal IDs, V36, runs, models, providers, or workflow stages in segment text.",
          "Return exactly JSON: {\"needsNewKnowledge\":boolean,\"segments\":[{\"claimId\":\"...\",\"text\":\"...\"}]} and no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Requested presentation: ${input.mode}`,
          `Knowledge objective: ${input.knowledge.objective}`,
          "Governed findings:",
          ...input.knowledge.findings.map((finding) =>
            `[${finding.claimId}] status=${finding.status}; basis=${finding.basis ?? "CLAIM"}; text=${finding.text}`),
          `Known uncertainties: ${input.knowledge.uncertainties.join(" | ") || "none"}`,
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_200,
    seed: 0,
  };
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function safeRestatement(original: string, candidate: string): string | null {
  if (normalized(original) === normalized(candidate)) return candidate.trim();
  return validateKnowledgeSimplification(original, candidate);
}

function renderFinding(finding: KnowledgeFinding, text: string): string {
  if (finding.basis === "SOURCE_REPORT") {
    return `${text} This is a plain-language presentation of what the cited source reports; it does not independently verify a broader real-world claim.`;
  }
  switch (finding.status) {
    case "SUPPORTED": return text;
    case "REFUTED": return `The governed evidence refutes this: ${text}`;
    case "CONFLICTED": return `The governed evidence remains materially conflicted: ${text}`;
    case "UNRESOLVED": return `The available governed evidence does not establish this strongly enough: ${text}`;
  }
}

export class ModelSolandraKnowledgePresenter implements SolandraKnowledgePresenter {
  constructor(
    private readonly runtime: ModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra Knowledge presentation model must be non-empty.");
  }

  async present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult> {
    if (input.knowledge.findings.length === 0) {
      return Object.freeze({
        status: "NEEDS_NEW_KNOWLEDGE",
        text: null,
        invocationProvenance: {
          executionClass: null,
          routeMode: null,
          requestedProvider: null,
          requestedModel: this.model,
          actualProvider: null,
          actualModel: null,
          brokerIdentity: null,
          brokerVersion: null,
          upstreamRequestId: null,
          routeProvenance: "MISSING",
        },
      });
    }
    const result = await this.runtime.call(buildRequest(this.model, input), {
      correlationId: `solandra-knowledge-present:${input.knowledgeId}:${input.userMessageId}`,
      idempotencyKey: `${input.mode}:${input.userMessageId}`,
      maxAttempts: 1,
    });
    const invocationProvenance = result.audit.invocationProvenance;
    if (result.response.output.length !== 1 || result.response.output[0]?.type !== "text") {
      return Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance });
    }
    const parsed = presentationOutputSchema.parse(parseJsonObject(result.response.output[0].text));
    if (parsed.needsNewKnowledge) {
      if (parsed.segments.length !== 0) {
        return Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance });
      }
      return Object.freeze({ status: "NEEDS_NEW_KNOWLEDGE", text: null, invocationProvenance });
    }
    if (parsed.segments.length === 0) {
      return Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance });
    }

    const findings = new Map(input.knowledge.findings.map((finding) => [finding.claimId, finding]));
    const seen = new Set<string>();
    const rendered: string[] = [];
    for (const segment of parsed.segments) {
      const finding = findings.get(segment.claimId);
      if (!finding || seen.has(segment.claimId)) {
        return Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance });
      }
      const text = safeRestatement(finding.text, segment.text);
      if (text === null) {
        return Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance });
      }
      seen.add(segment.claimId);
      rendered.push(renderFinding(finding, text));
    }

    const prefix = input.mode === "SIMPLIFY"
      ? "In plain language, based on the same established Knowledge:"
      : "Based on the same established Knowledge:";
    return Object.freeze({
      status: "PRESENTED",
      text: `${prefix}\n\n${rendered.join("\n\n")}\n\nThe underlying Knowledge and its sources are unchanged.`,
      invocationProvenance,
    });
  }
}
