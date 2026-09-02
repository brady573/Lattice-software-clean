import {
  prepareV36Resume,
  type V36OperationalFailure,
  type V36PreparedResume,
  type V36ResearchCheckpoint,
  type V36ResearchExecutionResult,
  type V36ResearchRequest,
} from "./continuation.js";
import {
  validateResearchResult,
  type ResearchRequest,
  type ResearchResult,
} from "./pipeline.js";
import type {
  EvidenceRelation,
  ProvenanceConfidence,
  SourceEdgeType,
} from "./types.js";

/**
 * Execution Runtime handoff shape before protected V36 re-entry. Successful
 * payloads deliberately remain opaque here; this contract grants no truth
 * authority and mirrors the durable bridge's operational result envelope.
 */
export type V36RuntimeExecutionResult =
  | {
      requestId: string;
      runId: string;
      outcome: "SUCCEEDED";
      result: unknown;
      operationalFailure: null;
    }
  | {
      requestId: string;
      runId: string;
      outcome: "OPERATIONAL_FAILURE";
      result: null;
      operationalFailure: V36OperationalFailure;
    };

const evidenceRelations = new Set<EvidenceRelation>([
  "SUPPORTS",
  "CONTRADICTS",
  "CONTEXT",
  "NEUTRAL",
]);
const provenanceConfidences = new Set<ProvenanceConfidence>([
  "HIGH",
  "MODERATE",
  "LOW",
  "UNKNOWN",
]);
const sourceEdgeTypes = new Set<SourceEdgeType>([
  "CITES",
  "DERIVES_FROM",
  "SYNDICATES",
  "COPIES",
  "MIRRORS",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function nullableStringField(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringField(value, label);
}

function finiteNumberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function toResearchRequest(request: V36ResearchRequest): ResearchRequest {
  return {
    id: request.id,
    runId: request.runId,
    claimId: request.claimId,
    parentQuestionId: request.parentRequestId,
    purpose: request.purpose,
    query: request.query,
    serialRound: request.serialRound,
  };
}

/**
 * Convert an opaque runtime/provider payload into the canonical untrusted
 * ResearchResult shape. The conversion is structural only. V36's existing
 * validateResearchResult() then enforces Run scope and sanitizes authority-
 * shaped evidence fields before any admission policy is consulted.
 */
export function parseV36RuntimeResearchResult(
  request: V36ResearchRequest,
  value: unknown,
): ResearchResult {
  const root = record(value, "V36 successful runtime research result");
  if (!Array.isArray(root.artifacts) || !Array.isArray(root.edges) || !Array.isArray(root.evidence)) {
    throw new Error("V36 successful runtime research result must contain artifacts, edges, and evidence arrays.");
  }

  const artifacts = root.artifacts.map((entry, index) => {
    const artifact = record(entry, `V36 runtime artifact ${index}`);
    const metadata = record(artifact.metadata, `V36 runtime artifact ${index} metadata`);
    const provenanceConfidence = stringField(
      artifact.provenanceConfidence,
      `V36 runtime artifact ${index} provenanceConfidence`,
    ) as ProvenanceConfidence;
    if (!provenanceConfidences.has(provenanceConfidence)) {
      throw new Error(`V36 runtime artifact ${index} has an invalid provenanceConfidence.`);
    }
    if (artifact.authoritativePrimary !== true && artifact.authoritativePrimary !== false) {
      throw new Error(`V36 runtime artifact ${index} authoritativePrimary must be boolean.`);
    }
    if (artifact.untrusted !== true) {
      throw new Error(`V36 runtime artifact ${index} must remain explicitly untrusted.`);
    }
    return {
      id: stringField(artifact.id, `V36 runtime artifact ${index} id`),
      runId: stringField(artifact.runId, `V36 runtime artifact ${index} runId`),
      canonicalUri: stringField(artifact.canonicalUri, `V36 runtime artifact ${index} canonicalUri`),
      artifactHash: stringField(artifact.artifactHash, `V36 runtime artifact ${index} artifactHash`),
      publisher: nullableStringField(artifact.publisher, `V36 runtime artifact ${index} publisher`),
      originKey: nullableStringField(artifact.originKey, `V36 runtime artifact ${index} originKey`),
      provenanceComponentKey: nullableStringField(
        artifact.provenanceComponentKey,
        `V36 runtime artifact ${index} provenanceComponentKey`,
      ),
      provenanceConfidence,
      authoritativePrimary: artifact.authoritativePrimary,
      retrievedAt: stringField(artifact.retrievedAt, `V36 runtime artifact ${index} retrievedAt`),
      publishedAt: nullableStringField(artifact.publishedAt, `V36 runtime artifact ${index} publishedAt`),
      effectiveFrom: nullableStringField(artifact.effectiveFrom, `V36 runtime artifact ${index} effectiveFrom`),
      effectiveTo: nullableStringField(artifact.effectiveTo, `V36 runtime artifact ${index} effectiveTo`),
      contentType: stringField(artifact.contentType, `V36 runtime artifact ${index} contentType`),
      metadata: structuredClone(metadata),
      untrusted: true as const,
    };
  });

  const edges = root.edges.map((entry, index) => {
    const edge = record(entry, `V36 runtime source edge ${index}`);
    const edgeType = stringField(edge.edgeType, `V36 runtime source edge ${index} edgeType`) as SourceEdgeType;
    if (!sourceEdgeTypes.has(edgeType)) {
      throw new Error(`V36 runtime source edge ${index} has an invalid edgeType.`);
    }
    return {
      id: stringField(edge.id, `V36 runtime source edge ${index} id`),
      runId: stringField(edge.runId, `V36 runtime source edge ${index} runId`),
      fromArtifactId: stringField(edge.fromArtifactId, `V36 runtime source edge ${index} fromArtifactId`),
      toArtifactId: stringField(edge.toArtifactId, `V36 runtime source edge ${index} toArtifactId`),
      edgeType,
      confidence: finiteNumberField(edge.confidence, `V36 runtime source edge ${index} confidence`),
      contentSimilarity: edge.contentSimilarity === null
        ? null
        : finiteNumberField(edge.contentSimilarity, `V36 runtime source edge ${index} contentSimilarity`),
    };
  });

  const evidence = root.evidence.map((entry, index) => {
    const candidate = record(entry, `V36 runtime evidence ${index}`);
    const relation = stringField(candidate.relation, `V36 runtime evidence ${index} relation`) as EvidenceRelation;
    if (!evidenceRelations.has(relation)) {
      throw new Error(`V36 runtime evidence ${index} has an invalid relation.`);
    }
    return {
      artifactId: stringField(candidate.artifactId, `V36 runtime evidence ${index} artifactId`),
      externalEvidenceId: stringField(
        candidate.externalEvidenceId,
        `V36 runtime evidence ${index} externalEvidenceId`,
      ),
      relation,
      specificEvidence: stringField(candidate.specificEvidence, `V36 runtime evidence ${index} specificEvidence`),
    };
  });

  return validateResearchResult(
    toResearchRequest(request),
    { artifacts, edges, evidence },
  );
}

/**
 * Fail-closed boundary from durable operational results into the canonical V36
 * continuation envelope. This performs no evidence admission or truth verdict.
 */
export function prepareV36RuntimeResume(
  checkpoint: V36ResearchCheckpoint,
  results: readonly V36RuntimeExecutionResult[],
): V36PreparedResume {
  const requestById = new Map(checkpoint.researchRequests.map((request) => [request.id, request] as const));
  const canonical = results.map<V36ResearchExecutionResult>((result) => {
    if (result.outcome === "OPERATIONAL_FAILURE") {
      return structuredClone(result);
    }
    const request = requestById.get(result.requestId);
    if (!request) {
      throw new Error(`V36 runtime handoff received an unrequested result: ${result.requestId}`);
    }
    return {
      requestId: result.requestId,
      runId: result.runId,
      outcome: "SUCCEEDED",
      result: parseV36RuntimeResearchResult(request, result.result),
      operationalFailure: null,
    };
  });
  return prepareV36Resume(checkpoint, canonical);
}
