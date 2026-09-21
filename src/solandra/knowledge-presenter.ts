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
    text: string | null;
    invocationProvenance: ModelInvocationProvenance;
  }>;

export interface SolandraKnowledgePresenter {
  present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult>;
}

const presentationOutputSchema = z.object({
  needsNewKnowledge: z.boolean(),
  segments: z.array(z.object({
    claimId: z.string().min(1).max(300),
    text: z.string().min(1).max(16_000).optional(),
  }).strict()).max(16),
}).strict();

const NEGATION_PATTERN = /\b(?:no|not|never|neither|nor|without|cannot|can't|doesn't|don't|isn't|aren't|wasn't|weren't|didn't|won't|wouldn't|shouldn't|couldn't|mustn't)\b/iu;
const UNCERTAINTY_PATTERN = /\b(?:may|might|could|possibly|possible|uncertain|unclear|appears?|suggests?|likely|unlikely|risk|association|associated)\b/iu;
const CONDITION_PATTERN = /\b(?:if|unless|except|only|when|while|during|before|after|until|under|depending)\b/iu;
const NUMBER_PATTERN = /(?:[$€£¥]\s*)?\b\d+(?:[.,]\d+)*(?:\s*%|\s*[a-zA-Z]{1,8})?/gu;
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9-]{1,}\b/gu;
const SEMANTIC_MARKER_APOSTROPHE_PATTERN = /[\u2018\u2019\u02BC\uFF07]/gu;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeSemanticMarkerTypography(value: string): string {
  return value.replace(SEMANTIC_MARKER_APOSTROPHE_PATTERN, "'");
}

function matches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => normalizeWhitespace(match[0] ?? ""));
}

function containsProtectedRewriteMaterial(value: string): boolean {
  const normalized = normalizeSemanticMarkerTypography(value);
  return NEGATION_PATTERN.test(normalized)
    || UNCERTAINTY_PATTERN.test(normalized)
    || CONDITION_PATTERN.test(normalized)
    || matches(value, NUMBER_PATTERN).length > 0
    || matches(value, ACRONYM_PATTERN).length > 0;
}

/**
 * Bounded defense-in-depth for rewrite drift. Exact governed wording is always
 * safe. Changed text containing protected high-risk material fails closed
 * because this deterministic layer cannot establish proposition-level marker
 * attachment without becoming semantic machinery. Authority remains
 * exclusively in Knowledge.
 */
export function validateKnowledgePresentationRewrite(
  originalText: string,
  candidateText: string,
): string | null {
  const original = normalizeWhitespace(originalText);
  const candidate = normalizeWhitespace(candidateText);
  if (!original || !candidate) return null;
  if (candidate === original) return originalText;
  if (containsProtectedRewriteMaterial(original) || containsProtectedRewriteMaterial(candidate)) return null;
  if (candidate.length < 12 || candidate.length > Math.max(600, original.length * 2)) return null;
  return candidate;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
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
          "You are Solandra presenting an already-governed Lattice Knowledge object. Presentation is never Knowledge authority.",
          "Use only the supplied findings. Do not add facts, examples, causes, consequences, quantities, dates, recommendations, source claims, certainty, or qualifications absent from them.",
          "If the requested presentation would require any externally factual claim not present in the findings, set needsNewKnowledge=true and return no segments.",
          "Every segment claimId must exactly match one supplied finding. Keep findings claim-separated; never merge supported, refuted, conflicted, or unresolved propositions into a stronger combined claim.",
          "For EXPLAIN, select and order exact claimIds and omit text. Lattice renders the governed wording.",
          "For SIMPLIFY, return a faithful easier-to-understand rewrite in text for each selected claimId. Preserve every material proposition, negation, uncertainty, condition, exception, scope boundary, quantity, date, comparison, causal strength, acronym, and technical identifier whose change could alter meaning.",
          "For SIMPLIFY, do not copy the original wording unchanged when a faithful simplification is possible. Do not add status labels, uncertainty summaries, provenance, temporal qualifications, or authority language; Lattice attaches those from exact Knowledge outside your rewrite.",
          "Return exactly JSON: {\"needsNewKnowledge\":boolean,\"segments\":[{\"claimId\":\"...\",\"text\":\"... only for SIMPLIFY\"}]} and no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Requested presentation: ${input.mode}`,
          `Knowledge objective: ${input.knowledge.objective}`,
          "Governed findings:",
          ...input.knowledge.findings.map((finding) =>
            `[${finding.claimId}] status=${finding.status}; confidence=${finding.confidence}; basis=${finding.basis ?? "CLAIM"}; effectiveAt=${finding.temporalQualifiers.effectiveAt ?? "none"}; period=${finding.temporalQualifiers.period ?? "none"}; text=${finding.text}`),
          `Known uncertainties: ${input.knowledge.uncertainties.join(" | ") || "none"}`,
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_200,
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

function temporalQualification(finding: KnowledgeFinding): string {
  const parts = [
    finding.temporalQualifiers.effectiveAt === null
      ? ""
      : `Effective at: ${finding.temporalQualifiers.effectiveAt}`,
    finding.temporalQualifiers.period === null
      ? ""
      : `Period: ${finding.temporalQualifiers.period}`,
  ].filter(Boolean);
  return parts.length === 0 ? "" : parts.join("; ");
}

function renderFindingSources(knowledge: KnowledgeOutcome, finding: KnowledgeFinding): string {
  const evidenceIds = new Set([...finding.evidenceIds, ...finding.contradictoryEvidenceIds]);
  const sourceIds = new Set(
    (knowledge.evidence ?? [])
      .filter((evidence) => evidence.admitted && evidenceIds.has(evidence.evidenceId))
      .map((evidence) => evidence.sourceId),
  );
  const sources = knowledge.provenance.filter((source) => sourceIds.has(source.sourceId));
  if (sources.length === 0) {
    return "Sources for this finding:\n- No admitted source is linked to this finding.";
  }
  return [
    "Sources for this finding:",
    ...sources.map((source) => {
      const title = source.title.trim() || source.canonicalUri;
      const publisher = source.publisher ? ` — ${source.publisher}` : "";
      return `- ${title}${publisher}\n  ${source.canonicalUri}`;
    }),
  ].join("\n");
}

function renderFinding(
  knowledge: KnowledgeOutcome,
  finding: KnowledgeFinding,
  text = finding.text,
): string {
  let rendered: string;
  if (finding.basis === "SOURCE_REPORT") {
    rendered = `Source report: ${text} This status concerns what the retrieved source material reports; it does not independently verify the broader real-world claim.`;
  } else {
    switch (finding.status) {
      case "SUPPORTED": rendered = text; break;
      case "REFUTED": rendered = `The governed evidence refutes this: ${text}`; break;
      case "CONFLICTED": rendered = `The governed evidence remains materially conflicted: ${text}`; break;
      case "UNRESOLVED": rendered = `The available governed evidence does not establish this strongly enough: ${text}`; break;
    }
  }
  return [
    `Status: ${statusLabel(finding)}; confidence: ${finding.confidence}.`,
    rendered,
    temporalQualification(finding),
    renderFindingSources(knowledge, finding),
  ].filter(Boolean).join("\n");
}

function renderUncertainties(knowledge: KnowledgeOutcome): string {
  if (knowledge.uncertainties.length === 0) return "";
  return `Known uncertainty:\n${knowledge.uncertainties.map((item) => `- ${item}`).join("\n")}`;
}

function noModelInvocationProvenance(model: string): ModelInvocationProvenance {
  return {
    executionClass: null,
    routeMode: null,
    requestedProvider: null,
    requestedModel: model,
    actualProvider: null,
    actualModel: null,
    brokerIdentity: null,
    brokerVersion: null,
    upstreamRequestId: null,
    routeProvenance: "MISSING",
  };
}

function renderSelection(
  knowledge: KnowledgeOutcome,
  selected: readonly Readonly<{ finding: KnowledgeFinding; text: string }>[],
  fallback: boolean,
): string {
  return [
    fallback
      ? "I couldn't simplify every selected finding faithfully, so any rejected rewrite below uses the original governed wording."
      : "",
    selected.map(({ finding, text }) => renderFinding(knowledge, finding, text)).join("\n\n"),
    renderUncertainties(knowledge),
    "The underlying Knowledge, claim identities, statuses, uncertainty, provenance, and sources are unchanged.",
  ].filter(Boolean).join("\n\n");
}

function renderSparseKnowledgeSources(knowledge: KnowledgeOutcome): string {
  if (knowledge.provenance.length === 0) {
    return "Sources:\n- No admitted source is linked to this Knowledge.";
  }
  return [
    "Sources:",
    ...knowledge.provenance.map((source) => {
      const title = source.title.trim() || source.canonicalUri;
      const publisher = source.publisher ? ` — ${source.publisher}` : "";
      return `- ${title}${publisher}\n  ${source.canonicalUri}`;
    }),
  ].join("\n");
}

function renderSparseKnowledge(knowledge: KnowledgeOutcome): string {
  return [
    "This established Knowledge contains no governed findings.",
    renderUncertainties(knowledge),
    renderSparseKnowledgeSources(knowledge),
    "The underlying Knowledge and its sources are unchanged.",
  ].filter(Boolean).join("\n\n");
}

function fallbackAll(
  input: SolandraKnowledgePresentationInput,
  invocationProvenance: ModelInvocationProvenance,
): SolandraKnowledgePresentationResult {
  return Object.freeze({
    status: "FIDELITY_REJECTED" as const,
    text: renderSelection(
      input.knowledge,
      input.knowledge.findings.map((finding) => ({ finding, text: finding.text })),
      true,
    ),
    invocationProvenance,
  });
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
        status: "PRESENTED",
        text: renderSparseKnowledge(input.knowledge),
        invocationProvenance: noModelInvocationProvenance(this.model),
      });
    }
    const result = await this.runtime.call(buildRequest(this.model, input), {
      correlationId: `solandra-knowledge-present:${input.knowledgeId}:${input.userMessageId}`,
      idempotencyKey: `${input.mode}:${input.userMessageId}`,
      maxAttempts: 1,
    });
    const invocationProvenance = result.audit.invocationProvenance;
    if (result.response.output.length !== 1 || result.response.output[0]?.type !== "text") {
      return fallbackAll(input, invocationProvenance);
    }
    let parsedResult;
    try {
      parsedResult = presentationOutputSchema.safeParse(parseJsonObject(result.response.output[0].text));
    } catch {
      return fallbackAll(input, invocationProvenance);
    }
    if (!parsedResult.success) return fallbackAll(input, invocationProvenance);
    const parsed = parsedResult.data;
    if (parsed.needsNewKnowledge) {
      if (parsed.segments.length !== 0) return fallbackAll(input, invocationProvenance);
      return Object.freeze({ status: "NEEDS_NEW_KNOWLEDGE", text: null, invocationProvenance });
    }
    if (parsed.segments.length === 0) return fallbackAll(input, invocationProvenance);

    const findings = new Map(input.knowledge.findings.map((finding) => [finding.claimId, finding]));
    const seen = new Set<string>();
    const selected: Array<{ finding: KnowledgeFinding; text: string }> = [];
    let fallback = false;
    for (const segment of parsed.segments) {
      const finding = findings.get(segment.claimId);
      if (!finding || seen.has(segment.claimId)) return fallbackAll(input, invocationProvenance);
      seen.add(segment.claimId);

      if (input.mode === "EXPLAIN") {
        if (segment.text !== undefined) return fallbackAll(input, invocationProvenance);
        selected.push({ finding, text: finding.text });
        continue;
      }

      const simplified = segment.text === undefined
        ? null
        : validateKnowledgePresentationRewrite(finding.text, segment.text);
      if (simplified === null) {
        fallback = true;
        selected.push({ finding, text: finding.text });
      } else {
        selected.push({ finding, text: simplified });
      }
    }

    const text = renderSelection(input.knowledge, selected, fallback);
    return Object.freeze({
      status: fallback ? "FIDELITY_REJECTED" as const : "PRESENTED" as const,
      text,
      invocationProvenance,
    });
  }
}
