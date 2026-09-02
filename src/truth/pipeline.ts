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
export interface ResearchEvidenceCandidate {
  artifactId: string;
  externalEvidenceId: string;
  relation: EvidenceRelation;
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

  const validatedArtifacts = artifacts.map((artifactValue) => {
    const artifact = requireRecord(artifactValue, "Research artifact") as unknown as SourceArtifact;
    if (artifact.untrusted !== true) {
      throw new Error("Research provider output must enter V36 as an untrusted SourceArtifact.");
    }
    if (artifact.runId !== request.runId) throw new Error("Research artifact crossed Run scope.");
    return structuredClone(artifact);
  });

  const validatedEdges = edges.map((edgeValue) => {
    const edge = requireRecord(edgeValue, "Research source edge") as unknown as SourceEdge;
    if (edge.runId !== request.runId) throw new Error("Research source edge crossed Run scope.");
    return structuredClone(edge);
  });

  const evidence = candidates.map((candidateValue) => {
    const rawCandidate = requireRecord(candidateValue, "Research evidence candidate");
    const candidate = rawCandidate as unknown as ResearchEvidenceCandidate;
    const legacyScope = rawCandidate as Partial<Pick<ClaimEvidence, "runId" | "claimId">>;
    if (
      (legacyScope.runId !== undefined && legacyScope.runId !== request.runId)
      || (legacyScope.claimId !== undefined && legacyScope.claimId !== request.claimId)
    ) {
      throw new Error("Research evidence crossed Run or claim scope.");
    }
    if (
      typeof candidate.artifactId !== "string"
      || typeof candidate.externalEvidenceId !== "string"
      || typeof candidate.specificEvidence !== "string"
      || candidate.artifactId.trim().length === 0
      || candidate.externalEvidenceId.trim().length === 0
      || candidate.specificEvidence.trim().length === 0
    ) {
      throw new Error("Research evidence candidate contains a blank or invalid required field.");
    }
    if (candidate.relation !== "SUPPORTS" && candidate.relation !== "CONTRADICTS") {
      throw new Error("Research evidence candidate has an invalid relation.");
    }
    return {
      artifactId: candidate.artifactId,
      externalEvidenceId: candidate.externalEvidenceId,
      relation: candidate.relation,
      specificEvidence: candidate.specificEvidence,
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
