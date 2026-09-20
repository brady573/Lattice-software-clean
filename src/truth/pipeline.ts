import { stableTruthUuid } from "./ids.js";
import type {
  ClaimEvidence,
  CompiledClaim,
  EvidenceRelation,
  EvidenceVerification,
  ProofCheck,
  ProvenanceConfidence,
  ResearchPurpose,
  SourceArtifact,
  SourceEdge,
  SourceEdgeType,
  TruthAssessment,
} from "./types.js";

export interface ResearchRequest {
  id: string;
  runId: string;
  claimId: string;
  parentQuestionId: string | null;
  purpose: ResearchPurpose;
  query: string;
  serialRound: number;
}

/**
 * Untrusted provider observation. Provider output deliberately has no fields
 * capable of granting V36 admission, verification, provenance independence,
 * or primary-source authority.
 */
export type ResearchEvidenceRelation = Extract<EvidenceRelation, "SUPPORTS" | "CONTRADICTS">;

export interface ResearchEvidenceCandidate {
  artifactId: string;
  externalEvidenceId: string;
  relation: ResearchEvidenceRelation;
  specificEvidence: string;
}

export interface ResearchResult {
  artifacts: SourceArtifact[];
  edges: SourceEdge[];
  evidence: ResearchEvidenceCandidate[];
}

export interface TruthResearchResult {
  artifacts: SourceArtifact[];
  edges: SourceEdge[];
  evidence: ClaimEvidence[];
}

export interface TruthResearchProvider {
  readonly mode: "offline-fixture" | "live-dormant";
  research(request: ResearchRequest): Promise<ResearchResult>;
}

export interface ResearchEvidenceDisposition {
  verification: EvidenceVerification;
  admitted: boolean;
  rejectionReason: string | null;
  provenanceComponentKey: string | null;
  provenanceConfidence: ProvenanceConfidence;
  authoritativePrimary: boolean;
}

export interface ResearchEvidenceAdmissionPolicy {
  disposition(
    request: ResearchRequest,
    candidate: ResearchEvidenceCandidate,
    result: ResearchResult,
  ): ResearchEvidenceDisposition;
}

const failClosedDisposition: ResearchEvidenceDisposition = Object.freeze({
  verification: "UNVERIFIED",
  admitted: false,
  rejectionReason: "Research evidence has not passed V36 truth-layer admission and verification.",
  provenanceComponentKey: null,
  provenanceConfidence: "UNKNOWN",
  authoritativePrimary: false,
});

export class FailClosedResearchEvidenceAdmissionPolicy implements ResearchEvidenceAdmissionPolicy {
  disposition(
    _request: ResearchRequest,
    _candidate: ResearchEvidenceCandidate,
    _result: ResearchResult,
  ): ResearchEvidenceDisposition {
    return { ...failClosedDisposition };
  }
}

function fixtureDispositionKey(requestId: string, externalEvidenceId: string): string {
  return `${requestId}\u0000${externalEvidenceId}`;
}

/**
 * Deterministic prototype/test policy. This is truth-layer fixture authority,
 * not provider authority, and is not part of the TruthResearchProvider contract.
 */
export class OfflineFixtureResearchAdmissionPolicy implements ResearchEvidenceAdmissionPolicy {
  private readonly dispositions: ReadonlyMap<string, ResearchEvidenceDisposition>;

  constructor(
    dispositions: Readonly<Record<string, Readonly<Record<string, ResearchEvidenceDisposition>>>> = {},
  ) {
    const map = new Map<string, ResearchEvidenceDisposition>();
    for (const [requestId, byEvidenceId] of Object.entries(dispositions)) {
      for (const [externalEvidenceId, disposition] of Object.entries(byEvidenceId)) {
        map.set(fixtureDispositionKey(requestId, externalEvidenceId), structuredClone(disposition));
      }
    }
    this.dispositions = map;
  }

  disposition(
    request: ResearchRequest,
    candidate: ResearchEvidenceCandidate,
    _result: ResearchResult,
  ): ResearchEvidenceDisposition {
    return structuredClone(
      this.dispositions.get(fixtureDispositionKey(request.id, candidate.externalEvidenceId))
        ?? failClosedDisposition,
    );
  }
}

export interface TruthPipelineDependencies {
  research: TruthResearchProvider;
}

export interface TruthPipeline {
  assessClaim(
    claim: CompiledClaim,
    dependencies: TruthPipelineDependencies,
  ): Promise<{
    checks: ProofCheck[];
    assessment: TruthAssessment;
    serialRounds: number;
  }>;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function requireProvenanceConfidence(value: unknown, label: string): ProvenanceConfidence {
  switch (value) {
    case "HIGH":
    case "MODERATE":
    case "LOW":
    case "UNKNOWN":
      return value;
    default:
      throw new Error(`${label} has an invalid provenanceConfidence.`);
  }
}

function requireSourceEdgeType(value: unknown, label: string): SourceEdgeType {
  switch (value) {
    case "CITES":
    case "DERIVES_FROM":
    case "SYNDICATES":
    case "COPIES":
    case "MIRRORS":
      return value;
    default:
      throw new Error(`${label} has an invalid edgeType.`);
  }
}

function requireResearchEvidenceRelation(
  value: unknown,
  label: string,
): ResearchEvidenceRelation {
  switch (value) {
    case "SUPPORTS":
    case "CONTRADICTS":
      return value;
    default:
      throw new Error(`${label} has an invalid relation.`);
  }
}

function requireNonBlankString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (text.trim().length === 0) {
    throw new Error("Research evidence candidate contains a blank or invalid required field.");
  }
  return text;
}

/**
 * Validate and sanitize an untrusted provider/runtime result for one exact V36
 * research request. Authority-shaped extra fields are deliberately discarded.
 */
export function validateResearchResult(
  request: ResearchRequest,
  result: unknown,
): ResearchResult {
  const raw = requireRecord(result, "Research result");
  const artifacts = requireArray(raw.artifacts, "Research result artifacts");
  const edges = requireArray(raw.edges, "Research result edges");
  const candidates = requireArray(raw.evidence, "Research result evidence");

  const validatedArtifacts = artifacts.map((artifactValue, index) => {
    const label = `Research artifact ${index}`;
    const artifact = requireRecord(artifactValue, label);
    const runId = requireString(artifact.runId, `${label} runId`);
    if (runId !== request.runId) throw new Error("Research artifact crossed Run scope.");
    if (artifact.untrusted !== true) {
      throw new Error("Research provider output must enter V36 as an untrusted SourceArtifact.");
    }
    const authoritativePrimary = artifact.authoritativePrimary;
    if (typeof authoritativePrimary !== "boolean") {
      throw new Error(`${label} authoritativePrimary must be boolean.`);
    }
    return {
      id: requireString(artifact.id, `${label} id`),
      runId,
      canonicalUri: requireString(artifact.canonicalUri, `${label} canonicalUri`),
      artifactHash: requireString(artifact.artifactHash, `${label} artifactHash`),
      publisher: requireNullableString(artifact.publisher, `${label} publisher`),
      originKey: requireNullableString(artifact.originKey, `${label} originKey`),
      provenanceComponentKey: requireNullableString(
        artifact.provenanceComponentKey,
        `${label} provenanceComponentKey`,
      ),
      provenanceConfidence: requireProvenanceConfidence(
        artifact.provenanceConfidence,
        label,
      ),
      authoritativePrimary,
      retrievedAt: requireString(artifact.retrievedAt, `${label} retrievedAt`),
      publishedAt: requireNullableString(artifact.publishedAt, `${label} publishedAt`),
      effectiveFrom: requireNullableString(artifact.effectiveFrom, `${label} effectiveFrom`),
      effectiveTo: requireNullableString(artifact.effectiveTo, `${label} effectiveTo`),
      contentType: requireString(artifact.contentType, `${label} contentType`),
      metadata: structuredClone(requireRecord(artifact.metadata, `${label} metadata`)),
      untrusted: true,
    } satisfies SourceArtifact;
  });

  const validatedEdges = edges.map((edgeValue, index) => {
    const label = `Research source edge ${index}`;
    const edge = requireRecord(edgeValue, label);
    const runId = requireString(edge.runId, `${label} runId`);
    if (runId !== request.runId) throw new Error("Research source edge crossed Run scope.");
    return {
      id: requireString(edge.id, `${label} id`),
      runId,
      fromArtifactId: requireString(edge.fromArtifactId, `${label} fromArtifactId`),
      toArtifactId: requireString(edge.toArtifactId, `${label} toArtifactId`),
      edgeType: requireSourceEdgeType(edge.edgeType, label),
      confidence: requireFiniteNumber(edge.confidence, `${label} confidence`),
      contentSimilarity: edge.contentSimilarity === null
        ? null
        : requireFiniteNumber(edge.contentSimilarity, `${label} contentSimilarity`),
    } satisfies SourceEdge;
  });

  const evidence = candidates.map((candidateValue, index) => {
    const label = `Research evidence candidate ${index}`;
    const rawCandidate = requireRecord(candidateValue, label);
    if (
      (rawCandidate.runId !== undefined && rawCandidate.runId !== request.runId)
      || (rawCandidate.claimId !== undefined && rawCandidate.claimId !== request.claimId)
    ) {
      throw new Error("Research evidence crossed Run or claim scope.");
    }
    return {
      artifactId: requireNonBlankString(rawCandidate.artifactId, `${label} artifactId`),
      externalEvidenceId: requireNonBlankString(
        rawCandidate.externalEvidenceId,
        `${label} externalEvidenceId`,
      ),
      relation: requireResearchEvidenceRelation(rawCandidate.relation, label),
      specificEvidence: requireNonBlankString(
        rawCandidate.specificEvidence,
        `${label} specificEvidence`,
      ),
    } satisfies ResearchEvidenceCandidate;
  });
  return { artifacts: validatedArtifacts, edges: validatedEdges, evidence };
}

/**
 * Convert one already-executed untrusted research result into truth-layer
 * ClaimEvidence. Only the supplied V36 admission policy may assign authority.
 */
export function admitResearchResult(
  request: ResearchRequest,
  rawResult: unknown,
  admissionPolicy: ResearchEvidenceAdmissionPolicy = new FailClosedResearchEvidenceAdmissionPolicy(),
): TruthResearchResult {
  const raw = validateResearchResult(request, rawResult);
  const evidence = raw.evidence.map<ClaimEvidence>((candidate) => {
    const disposition = admissionPolicy.disposition(request, candidate, raw);
    const verification = disposition.verification;
    const admitted = disposition.admitted && verification !== "REJECTED";
    return {
      id: stableTruthUuid(`${request.runId}:research-evidence:${request.id}:${candidate.externalEvidenceId}`),
      runId: request.runId,
      claimId: request.claimId,
      artifactId: candidate.artifactId,
      externalEvidenceId: candidate.externalEvidenceId,
      relation: candidate.relation,
      specificEvidence: candidate.specificEvidence,
      provenanceComponentKey: disposition.provenanceComponentKey,
      provenanceConfidence: disposition.provenanceConfidence,
      authoritativePrimary: disposition.authoritativePrimary,
      researchQuestionId: request.id,
      verification,
      admitted,
      rejectionReason: admitted
        ? null
        : disposition.rejectionReason
          ?? "Research evidence did not pass V36 truth-layer admission.",
    };
  });
  return { artifacts: raw.artifacts, edges: raw.edges, evidence };
}

export class OfflineFixtureResearchProvider implements TruthResearchProvider {
  readonly mode = "offline-fixture" as const;
  private readonly responses: Readonly<Record<string, ResearchResult>>;
  private readonly admissionPolicy: ResearchEvidenceAdmissionPolicy;

  constructor(
    responses: Readonly<Record<string, ResearchResult>>,
    admissionPolicy: ResearchEvidenceAdmissionPolicy = new FailClosedResearchEvidenceAdmissionPolicy(),
  ) {
    this.responses = structuredClone(responses);
    this.admissionPolicy = admissionPolicy;
  }

  getFixtureAdmissionPolicy(): ResearchEvidenceAdmissionPolicy {
    return this.admissionPolicy;
  }

  async research(request: ResearchRequest): Promise<ResearchResult> {
    const result = this.responses[request.id] ?? { artifacts: [], edges: [], evidence: [] };
    return validateResearchResult(request, result);
  }
}

function defaultAdmissionPolicy(provider: TruthResearchProvider): ResearchEvidenceAdmissionPolicy {
  return provider instanceof OfflineFixtureResearchProvider
    ? provider.getFixtureAdmissionPolicy()
    : new FailClosedResearchEvidenceAdmissionPolicy();
}

/**
 * Convert untrusted provider observations into ClaimEvidence only inside the
 * truth layer. Provider-supplied extra authority fields are never copied.
 */
export async function researchWithAdmission(
  provider: TruthResearchProvider,
  request: ResearchRequest,
  admissionPolicy: ResearchEvidenceAdmissionPolicy = defaultAdmissionPolicy(provider),
): Promise<TruthResearchResult> {
  const raw = await provider.research(request);
  return admitResearchResult(request, raw, admissionPolicy);
}

export class DormantLiveResearchProvider implements TruthResearchProvider {
  readonly mode = "live-dormant" as const;

  async research(_request: ResearchRequest): Promise<ResearchResult> {
    throw new Error("Live-provider truth research is dormant during the V36 prototype stage.");
  }
}
