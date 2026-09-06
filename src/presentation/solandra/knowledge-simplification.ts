import { isConsultationRunRequest, type LatticeRun } from "../../domain.js";
import { ModelRuntime } from "../../model/runtime.js";
import type { CanonicalModelRequest } from "../../model/types.js";
import type { KnowledgeFinding } from "../../outcome.js";

const SIMPLIFICATION_REQUEST_PATTERN = /\b(?:simpler|simply|plain language)\b/iu;
const UNSAFE_SENTINEL = "UNSAFE_TO_SIMPLIFY";
const NEGATION_PATTERN = /\b(?:no|not|never|neither|nor|without|cannot|can't|doesn't|don't|isn't|aren't|wasn't|weren't|didn't|won't|wouldn't|shouldn't|couldn't|mustn't)\b/iu;
const UNCERTAINTY_PATTERN = /\b(?:may|might|could|possibly|possible|uncertain|unclear|appears?|suggests?|likely|unlikely|risk|association|associated)\b/iu;
const CONDITION_PATTERN = /\b(?:if|unless|except|only|when|while|during|before|after|until|under|depending)\b/iu;
const NUMBER_PATTERN = /(?:[$€£¥]\s*)?\b\d+(?:[.,]\d+)*(?:\s*%|\s*[a-zA-Z]{1,8})?/gu;
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9-]{1,}\b/gu;
const SEMANTIC_MARKER_APOSTROPHE_PATTERN = /[\u2018\u2019\u02BC\uFF07]/gu;

export const KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE =
  "I couldn't simplify this faithfully, so I kept the original wording.";

export interface KnowledgeSimplificationInput {
  runId: string;
  finding: KnowledgeFinding;
}

export interface KnowledgeSimplifier {
  simplify(input: KnowledgeSimplificationInput): Promise<string | null>;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeSemanticMarkerTypography(value: string): string {
  return value.replace(SEMANTIC_MARKER_APOSTROPHE_PATTERN, "'");
}

function matches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => normalizeWhitespace(match[0] ?? ""));
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of right) {
    const remaining = counts.get(value);
    if (remaining === undefined || remaining === 0) return false;
    if (remaining === 1) counts.delete(value);
    else counts.set(value, remaining - 1);
  }
  return counts.size === 0;
}

function preservesSemanticMarker(original: string, candidate: string, pattern: RegExp): boolean {
  const normalizedOriginal = normalizeSemanticMarkerTypography(original);
  const normalizedCandidate = normalizeSemanticMarkerTypography(candidate);
  return pattern.test(normalizedOriginal) === pattern.test(normalizedCandidate);
}

/**
 * Conservative mechanical checks for obvious semantic drift. They are not a
 * truth validator; they only reject rewrites that visibly lose or introduce
 * high-risk meaning markers before presentation.
 */
export function validateKnowledgeSimplification(
  originalText: string,
  candidateText: string,
): string | null {
  const original = normalizeWhitespace(originalText);
  const candidate = normalizeWhitespace(candidateText);
  if (!original || !candidate || candidate === UNSAFE_SENTINEL) return null;
  if (candidate === original) return null;
  if (candidate.length < 12 || candidate.length > Math.max(600, original.length * 2)) return null;

  if (!preservesSemanticMarker(original, candidate, NEGATION_PATTERN)) return null;
  if (!preservesSemanticMarker(original, candidate, UNCERTAINTY_PATTERN)) return null;
  if (!preservesSemanticMarker(original, candidate, CONDITION_PATTERN)) return null;

  if (!sameMultiset(matches(original, NUMBER_PATTERN), matches(candidate, NUMBER_PATTERN))) return null;
  if (!sameMultiset(matches(original, ACRONYM_PATTERN), matches(candidate, ACRONYM_PATTERN))) return null;

  return candidate;
}

export function knowledgeSimplificationRequested(run: LatticeRun): boolean {
  if (!isConsultationRunRequest(run.request)) return false;
  const latest = run.request.context.at(-1)?.trim() ?? "";
  return latest.length > 0 && SIMPLIFICATION_REQUEST_PATTERN.test(latest);
}

export function buildKnowledgeSimplificationRequest(
  model: string,
  finding: KnowledgeFinding,
): CanonicalModelRequest {
  const statusContext = [
    `Status: ${finding.status}`,
    `Basis: ${finding.basis ?? "CLAIM"}`,
    finding.temporalQualifiers.effectiveAt
      ? `Effective at: ${finding.temporalQualifiers.effectiveAt}`
      : "Effective at: none specified",
    finding.temporalQualifiers.period
      ? `Period: ${finding.temporalQualifiers.period}`
      : "Period: none specified",
  ].join("\n");

  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "Rewrite exactly one already-qualified knowledge finding in plain language for an ordinary reader.",
          `Return only the rewritten finding, or exactly ${UNSAFE_SENTINEL} if a faithful simplification is not possible.`,
          "Preserve every material proposition, negation, uncertainty, condition, exception, scope boundary, quantity, date, comparison, and causal strength.",
          "Do not add examples, explanations, causes, consequences, recommendations, facts, certainty, or source claims that are absent from the original finding.",
          "Do not add status labels or provenance language; Lattice applies those outside the rewrite.",
          "Prefer common words and shorter sentence structure, but keep a precise technical term when replacing it would risk changing meaning.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `${statusContext}\n\nOriginal finding:\n${finding.text}`,
      },
    ],
    temperature: 0,
    maxOutputTokens: 384,
    seed: 0,
  };
}

export class ModelKnowledgeSimplifier implements KnowledgeSimplifier {
  constructor(
    private readonly runtime: ModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Knowledge simplifier model must be non-empty.");
  }

  async simplify(input: KnowledgeSimplificationInput): Promise<string | null> {
    const request = buildKnowledgeSimplificationRequest(this.model, input.finding);
    try {
      const result = await this.runtime.call(request, {
        correlationId: `knowledge-simplify:${input.runId}:${input.finding.claimId}`,
        idempotencyKey: `presentation:${input.finding.claimId}`,
        maxAttempts: 1,
      });
      if (result.response.output.length !== 1) return null;
      const output = result.response.output[0];
      if (!output || output.type !== "text") return null;
      return validateKnowledgeSimplification(input.finding.text, output.text);
    } catch {
      return null;
    }
  }
}
