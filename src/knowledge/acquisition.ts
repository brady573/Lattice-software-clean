import type { ClaimType, EvidenceRelation } from "../truth/types.js";

/** Exact current work supplied to a replaceable information-acquisition adapter. */
export interface KnowledgeAcquisitionRequest {
  readonly runId: string;
  readonly objective: string;
  /** Non-authoritative current-turn work context; it never replaces objective. */
  readonly context: readonly string[];
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

/** A proposed relationship that remains untrusted until V36 qualifies it. */
export interface RetrievedKnowledgeEvidence {
  readonly sourceId: string;
  readonly relation: EvidenceRelation;
  readonly excerpt: string;
}

/** A provider-proposed claim. Provider output never supplies a verdict. */
export interface RetrievedKnowledgeClaim {
  readonly claimId: string;
  readonly text: string;
  readonly claimType: ClaimType;
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
