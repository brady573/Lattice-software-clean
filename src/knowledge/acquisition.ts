import type { ClaimQualifier, ClaimType, EvidenceRelation, EvidenceRisk } from "../truth/types.js";

/** Exact current work supplied to a replaceable information-acquisition adapter. */
export interface KnowledgeAcquisitionRequest {
  readonly runId: string;
  readonly objective: string;
  /** Non-authoritative current-turn work context; it never replaces objective. */
  readonly context: readonly string[];
  /** Optional non-authoritative operational queries derived from the objective/current work. */
  readonly investigationQueries?: readonly string[] | undefined;
}

/**
 * Retrieved information only. The adapter may identify and return source
 * content, but it cannot mark evidence admitted, verified, true, or confident.
 */
export interface RetrievedKnowledgeSource {
  readonly sourceId: string;
  readonly canonicalUri: string;
  readonly title: string;
  readonly publisher: string | null;
  readonly retrievedAt: string;
  readonly publishedAt: string | null;
  readonly contentType: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * A proposed relationship that remains untrusted until V36 qualifies it.
 * The excerpt is source-bound material, not an admission or truth verdict.
 */
export interface RetrievedKnowledgeEvidence {
  readonly sourceId: string;
  readonly relation: EvidenceRelation;
  readonly excerpt: string;
}

/**
 * A provider-proposed claim. Optional typed fields only preserve material
 * semantics the provider reports; they remain untrusted until V36 validates
 * the claim and its evidence. Existing simple source-report providers need not
 * supply them.
 */
export interface RetrievedKnowledgeClaim {
  readonly claimId: string;
  readonly text: string;
  readonly claimType: ClaimType;
  readonly scope?: string | null | undefined;
  readonly effectiveAt?: string | null | undefined;
  readonly jurisdiction?: string | null | undefined;
  readonly unit?: string | null | undefined;
  readonly denominator?: string | null | undefined;
  readonly baseline?: string | null | undefined;
  readonly period?: string | null | undefined;
  readonly causalRelation?: string | null | undefined;
  readonly authenticityTarget?: string | null | undefined;
  readonly comparisonClass?: string | null | undefined;
  readonly quotedContext?: string | null | undefined;
  readonly qualifiers?: readonly ClaimQualifier[] | undefined;
  readonly evidenceRisk?: EvidenceRisk | undefined;
  readonly evidence: readonly RetrievedKnowledgeEvidence[];
}

export interface KnowledgeAcquisitionResult {
  readonly sources: readonly RetrievedKnowledgeSource[];
  readonly claims: readonly RetrievedKnowledgeClaim[];
}

/**
 * Domain-neutral operational seam for external information retrieval. It has
 * no V36 admission, truth, intent, decision, or presentation authority.
 */
export interface KnowledgeAcquisitionProvider {
  readonly kind: string;
  acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult>;
}
