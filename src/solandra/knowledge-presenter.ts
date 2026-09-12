import { z } from "zod";
import { ModelProviderError } from "../model/errors.js";
import { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest, ModelInvocationProvenance } from "../model/types.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../outcome.js";

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
          "Otherwise select and order the governed findings that should be presented. Each claimId must exactly match a supplied finding.",
          "Do not rewrite, paraphrase, compress, or replace factual finding text. Lattice renders the authoritative proposition from governed Knowledge after your selection.",
          "Return exactly JSON: {\"needsNewKnowledge\":boolean,\"segments\":[{\"claimId\":\"...\"}]} and no prose.",
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
    maxOutputTokens: 800,
    seed: 0,
  };
}

function statusLabel(finding: KnowledgeFinding): string {
  switch (finding.status) {
    case "SUPPORTED": return "Supported";
    case "REFUTED": return "Refuted";
    case "CONFLICTED": return "Materially conflicted";
    case "UNRESOLVED": return "Unresolved";
  }
}

function renderFinding(finding: KnowledgeFinding): string {
  if (finding.basis === "SOURCE_REPORT") {
    return `${statusLabel(finding)} as a source report: ${finding.text} This status concerns what the retrieved source material reports; it does not independently verify the broader real-world claim.`;
  }
  switch (finding.status) {
    case "SUPPORTED": return finding.text;
    case "REFUTED": return `The governed evidence refutes this: ${finding.text}`;
    case "CONFLICTED": return `The governed evidence remains materially conflicted: ${finding.text}`;
    case "UNRESOLVED": return `The available governed evidence does not establish this strongly enough: ${finding.text}`;
  }
}

function renderUncertainties(knowledge: KnowledgeOutcome): string {
  if (knowledge.uncertainties.length === 0) return "";
  return `Known uncertainty:\n${knowledge.uncertainties.map((item) => `- ${item}`).join("\n")}`;
}

function renderSources(knowledge: KnowledgeOutcome): string {
  if (knowledge.provenance.length === 0) return "";
  const lines = knowledge.provenance.map((source) => {
    const title = source.title.trim() || source.canonicalUri;
    const publisher = source.publisher ? ` — ${source.publisher}` : "";
    return `- ${title}${publisher}\n  ${source.canonicalUri}`;
  });
  return `Sources:\n${lines.join("\n")}`;
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
          routeProvenance: "MISSING" as const,
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
    const parsedResult = presentationOutputSchema.safeParse(parseJsonObject(result.response.output[0].text));
    if (!parsedResult.success) {
      return Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance });
    }
    const parsed = parsedResult.data;
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
      seen.add(segment.claimId);
      rendered.push(renderFinding(finding));
    }

    const prefix = input.mode === "SIMPLIFY"
      ? "In plain language structure, using the same established factual wording:"
      : "Based on the same established Knowledge:";
    return Object.freeze({
      status: "PRESENTED",
      text: [
        `${prefix}\n\n${rendered.join("\n\n")}`,
        renderUncertainties(input.knowledge),
        renderSources(input.knowledge),
        "The underlying Knowledge and its sources are unchanged.",
      ].filter(Boolean).join("\n\n"),
      invocationProvenance,
    });
  }
}
