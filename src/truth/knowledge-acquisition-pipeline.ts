import { createHash } from "node:crypto";
import { isConsultationRunRequest, type LatticeRunRequest } from "../domain.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeEvidence,
  RetrievedKnowledgeSource,
} from "../knowledge/acquisition.js";
import { adjudicateClaim } from "./adjudication.js";
import { compileClaim } from "./claim-compiler.js";
import type { V36ResearchCheckpoint } from "./continuation.js";
import { stableTruthUuid } from "./ids.js";
import { normalizeProvenanceState } from "./provenance.js";
import {
  assertTruthSnapshotIntegrity,
  createTruthSnapshot,
  stableStructuredJson,
  type TruthSnapshot,
} from "./snapshot.js";
import type {
  ClaimEvidence,
  CompiledClaim,
  ProofCheck,
  ProofObligation,
  ProvenanceConfidence,
  SourceArtifact,
  TruthAssessment,
  TruthBundle,
} from "./types.js";
import type {
  TruthDurableValidationStep,
  TruthExecutionPipeline,
  TruthPipelineExecution,
  TruthPipelineInvestigation,
} from "./execution-pipeline.js";
import type { V36RuntimeExecutionResult } from "./runtime-handoff.js";

const MAX_SOURCES = 12;
const MAX_CLAIMS = 24;
const MAX_EVIDENCE_PER_CLAIM = 12;
const MAX_SOURCE_CONTENT_CHARS = 64_000;
const MAX_CLAIM_CHARS = 4_000;
const MAX_EXCERPT_CHARS = 8_000;

export interface KnowledgeEvidenceDisposition {
  readonly verification: "VERIFIED" | "UNVERIFIED" | "REJECTED";
  readonly admitted: boolean;
  readonly rejectionReason: string | null;
  readonly provenanceComponentKey: string | null;
  readonly provenanceConfidence: ProvenanceConfidence;
  readonly authoritativePrimary: boolean;
}

export interface KnowledgeEvidenceQualificationInput {
  readonly claim: CompiledClaim;
  readonly source: SourceArtifact;
  readonly sourceContent: string;
  readonly proposed: RetrievedKnowledgeEvidence;
}

/** V36-owned policy; acquisition adapters never receive or implement this authority. */
export interface KnowledgeEvidenceAdmissionPolicy {
  disposition(input: KnowledgeEvidenceQualificationInput): KnowledgeEvidenceDisposition;
}

const rejectedDisposition: KnowledgeEvidenceDisposition = Object.freeze({
  verification: "UNVERIFIED",
  admitted: false,
  rejectionReason: "Retrieved information did not pass source-bound V36 qualification.",
  provenanceComponentKey: null,
  provenanceConfidence: "UNKNOWN",
  authoritativePrimary: false,
});

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/**
 * Conservative default for exact source reports. It can verify that a claim is
 * a literal, content-integrity-bound report from the retrieved source. It does
 * not promote a provider summary, confidence field, or unsupported inference.
 */
export class ExactSourceReportAdmissionPolicy implements KnowledgeEvidenceAdmissionPolicy {
  disposition(input: KnowledgeEvidenceQualificationInput): KnowledgeEvidenceDisposition {
    const expectedHash = digest(`${input.source.canonicalUri}\u0000${input.sourceContent}`);
    const exactSourceReport = input.proposed.relation === "SUPPORTS"
      && normalizedText(input.claim.text) === normalizedText(input.proposed.excerpt)
      && input.sourceContent.includes(input.proposed.excerpt)
      && input.source.artifactHash === expectedHash
      && input.claim.qualifiers.some((item) => item.key === "source-report" && item.value === input.source.id);
    let canonical: URL;
    try {
      canonical = new URL(input.source.canonicalUri);
    } catch {
      return { ...rejectedDisposition };
    }
    if (!exactSourceReport || canonical.protocol !== "https:") return { ...rejectedDisposition };
    return {
      verification: "VERIFIED",
      admitted: true,
      rejectionReason: null,
      provenanceComponentKey: `source-origin:${digest(canonical.origin).slice(0, 24)}`,
      provenanceConfidence: "HIGH",
      // The source is primary only for the narrow literal report of its own content.
      authoritativePrimary: true,
    };
  }
}

type SanitizedAcquisition = {
  sources: RetrievedKnowledgeSource[];
  claims: RetrievedKnowledgeClaim[];
};

function nonBlank(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function sanitizeSource(value: RetrievedKnowledgeSource): RetrievedKnowledgeSource {
  const canonicalUri = nonBlank(value.canonicalUri, "Retrieved source canonicalUri", 8_000);
  const canonical = new URL(canonicalUri);
  if (canonical.protocol !== "https:" || canonical.username || canonical.password) {
    throw new Error("Retrieved source canonicalUri must be credential-free HTTPS.");
  }
  const retrievedAt = nonBlank(value.retrievedAt, "Retrieved source retrievedAt", 128);
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("Retrieved source retrievedAt is invalid.");
  const publishedAt = value.publishedAt === null
    ? null
    : nonBlank(value.publishedAt, "Retrieved source publishedAt", 128);
  if (publishedAt !== null && !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error("Retrieved source publishedAt is invalid.");
  }
  const metadata = value.metadata ?? {};
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Retrieved source metadata is invalid.");
  }
  return {
    sourceId: nonBlank(value.sourceId, "Retrieved source sourceId", 512),
    canonicalUri,
    title: nonBlank(value.title, "Retrieved source title", 1_000),
    publisher: value.publisher === null ? null : nonBlank(value.publisher, "Retrieved source publisher", 1_000),
    retrievedAt: new Date(retrievedAt).toISOString(),
    publishedAt: publishedAt === null ? null : new Date(publishedAt).toISOString(),
    contentType: nonBlank(value.contentType, "Retrieved source contentType", 256),
    content: nonBlank(value.content, "Retrieved source content", MAX_SOURCE_CONTENT_CHARS),
    metadata: Object.fromEntries(Object.entries(metadata).flatMap(([key, item]) => (
      typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null
        ? [[key, item] as const]
        : []
    ))),
  };
}

function sanitizeClaim(value: RetrievedKnowledgeClaim): RetrievedKnowledgeClaim {
  const claimTypes = new Set([
    "FACTUAL", "CAUSAL", "QUANTITATIVE", "CURRENT_STATE", "INTERPRETIVE", "AUTHENTICITY", "OPINION",
  ]);
  if (!claimTypes.has(value.claimType)) throw new Error("Retrieved claim claimType is invalid.");
  if (!Array.isArray(value.evidence) || value.evidence.length > MAX_EVIDENCE_PER_CLAIM) {
    throw new Error("Retrieved claim evidence exceeds its bound.");
  }
  return {
    claimId: nonBlank(value.claimId, "Retrieved claim claimId", 512),
    text: nonBlank(value.text, "Retrieved claim text", MAX_CLAIM_CHARS),
    claimType: value.claimType,
    evidence: value.evidence.map((item) => ({
      sourceId: nonBlank(item.sourceId, "Retrieved evidence sourceId", 512),
      relation: item.relation === "SUPPORTS" || item.relation === "CONTRADICTS"
        ? item.relation
        : (() => { throw new Error("Retrieved evidence relation is invalid."); })(),
      excerpt: nonBlank(item.excerpt, "Retrieved evidence excerpt", MAX_EXCERPT_CHARS),
    })),
  };
}

function sanitizeAcquisition(value: KnowledgeAcquisitionResult): SanitizedAcquisition {
  if (!value || typeof value !== "object" || !Array.isArray(value.sources) || !Array.isArray(value.claims)) {
    throw new Error("Knowledge acquisition result must contain source and claim arrays.");
  }
  if (value.sources.length > MAX_SOURCES || value.claims.length > MAX_CLAIMS) {
    throw new Error("Knowledge acquisition result exceeds its bounded source or claim count.");
  }
  const sources = value.sources.map(sanitizeSource);
  const claims = value.claims.map(sanitizeClaim);
  const sourceIds = new Set(sources.map((item) => item.sourceId));
  if (sourceIds.size !== sources.length) throw new Error("Retrieved source IDs must be unique.");
  const claimIds = new Set(claims.map((item) => item.claimId));
  if (claimIds.size !== claims.length) throw new Error("Retrieved claim IDs must be unique.");
  for (const claim of claims) {
    for (const evidence of claim.evidence) {
      if (!sourceIds.has(evidence.sourceId)) {
        throw new Error("Retrieved evidence references an unknown source.");
      }
    }
  }
  return { sources, claims };
}

function researchQuery(request: Extract<LatticeRunRequest, { kind: "consultation" }>): string {
  return [request.objective, ...request.context.map((item) => `Follow-up: ${item}`)].join("\n");
}

function emptyAssessment(
  claim: CompiledClaim,
  obligations: ProofObligation[],
  checks: ProofCheck[],
  evidence: ClaimEvidence[],
): TruthAssessment {
  return adjudicateClaim({
    assessmentId: stableTruthUuid(`${claim.runId}:assessment:${claim.id}`),
    claim,
    obligations,
    checks,
    evidence,
  });
}

function unavailableBundle(runId: string, query: string): TruthBundle {
  const compilation = compileClaim({
    runId,
    sourceClaimId: "acquisition-unavailable",
    text: "External information could not be established for this consultation.",
    claimType: "INTERPRETIVE",
    qualifiers: [{ key: "acquisition-state", value: "UNAVAILABLE_OR_INSUFFICIENT" }],
  });
  const obligations = compilation.requiredProofKinds.map<ProofObligation>((kind) => ({
    id: stableTruthUuid(`${runId}:obligation:acquisition-unavailable:${kind}`),
    runId,
    claimId: compilation.claim.id,
    kind,
    required: true,
  }));
  const checks = obligations.map<ProofCheck>((obligation) => ({
    id: stableTruthUuid(`${runId}:check:acquisition-unavailable:${obligation.kind}`),
    runId,
    obligationId: obligation.id,
    kind: obligation.kind,
    status: "UNRESOLVED",
    evidenceIds: [],
    explanation: "No source-bound evidence was available for this proof obligation.",
  }));
  return {
    runId,
    provenanceComponents: [],
    researchQuestions: [{
      id: stableTruthUuid(`${runId}:research:acquisition-unavailable`),
      runId,
      claimId: compilation.claim.id,
      parentQuestionId: null,
      purpose: "SUPPORT",
      query,
      serialRound: 1,
    }],
    sources: [],
    sourceEdges: [],
    claims: [compilation.claim],
    claimEvidence: [],
    obligations,
    checks,
    assessments: [emptyAssessment(compilation.claim, obligations, checks, [])],
  };
}

function investigatedBundle(
  runId: string,
  request: Extract<LatticeRunRequest, { kind: "consultation" }>,
  acquired: SanitizedAcquisition,
): TruthBundle {
  if (acquired.sources.length === 0 || acquired.claims.length === 0) {
    return unavailableBundle(runId, researchQuery(request));
  }
  const sourceByExternalId = new Map<string, SourceArtifact>();
  for (const source of acquired.sources) {
    const id = stableTruthUuid(`${runId}:source:${source.sourceId}`);
    sourceByExternalId.set(source.sourceId, {
      id,
      runId,
      canonicalUri: source.canonicalUri,
      artifactHash: digest(`${source.canonicalUri}\u0000${source.content}`),
      publisher: source.publisher,
      originKey: null,
      provenanceComponentKey: null,
      provenanceConfidence: "UNKNOWN",
      authoritativePrimary: false,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
      effectiveFrom: null,
      effectiveTo: null,
      contentType: source.contentType,
      metadata: {
        title: source.title,
        retrievedContent: source.content,
        acquisitionMetadata: source.metadata ?? {},
      },
      untrusted: true,
    });
  }

  const claims: CompiledClaim[] = [];
  const evidence: ClaimEvidence[] = [];
  const obligations: ProofObligation[] = [];
  const checks: ProofCheck[] = [];
  const assessments: TruthAssessment[] = [];
  const researchQuestions: TruthBundle["researchQuestions"] = [];

  for (const proposed of acquired.claims) {
    const singleSource = proposed.evidence.length === 1
      ? sourceByExternalId.get(proposed.evidence[0]!.sourceId)
      : undefined;
    const compilation = compileClaim({
      runId,
      sourceClaimId: proposed.claimId,
      text: proposed.text,
      claimType: proposed.claimType,
      qualifiers: singleSource ? [{ key: "source-report", value: singleSource.id }] : [],
    });
    claims.push(compilation.claim);
    const questionId = stableTruthUuid(`${runId}:research:${proposed.claimId}`);
    researchQuestions.push({
      id: questionId,
      runId,
      claimId: compilation.claim.id,
      parentQuestionId: null,
      purpose: "SUPPORT",
      query: researchQuery(request),
      serialRound: 1,
    });
    const claimEvidence = proposed.evidence.map<ClaimEvidence>((item, index) => {
      const source = sourceByExternalId.get(item.sourceId);
      if (!source) throw new Error("Sanitized acquisition lost a source binding.");
      return {
        id: stableTruthUuid(`${runId}:claim-evidence:${proposed.claimId}:${index}`),
        runId,
        claimId: compilation.claim.id,
        artifactId: source.id,
        externalEvidenceId: `retrieved:${proposed.claimId}:${index}`,
        relation: item.relation,
        specificEvidence: item.excerpt,
        provenanceComponentKey: null,
        provenanceConfidence: "UNKNOWN",
        authoritativePrimary: false,
        researchQuestionId: questionId,
        verification: "UNVERIFIED",
        admitted: false,
        rejectionReason: "Retrieved information has not yet passed V36 qualification.",
      };
    });
    evidence.push(...claimEvidence);
    const claimObligations = compilation.requiredProofKinds.map<ProofObligation>((kind) => ({
      id: stableTruthUuid(`${runId}:obligation:${proposed.claimId}:${kind}`),
      runId,
      claimId: compilation.claim.id,
      kind,
      required: true,
    }));
    obligations.push(...claimObligations);
    const claimChecks = claimObligations.map<ProofCheck>((obligation) => ({
      id: stableTruthUuid(`${runId}:check:${proposed.claimId}:${obligation.kind}`),
      runId,
      obligationId: obligation.id,
      kind: obligation.kind,
      status: "PENDING",
      evidenceIds: [],
      explanation: "Retrieved information is awaiting V36 qualification.",
    }));
    checks.push(...claimChecks);
    assessments.push(emptyAssessment(compilation.claim, claimObligations, claimChecks, claimEvidence));
  }

  return {
    runId,
    provenanceComponents: [],
    researchQuestions,
    sources: [...sourceByExternalId.values()],
    sourceEdges: [],
    claims,
    claimEvidence: evidence,
    obligations,
    checks,
    assessments,
  };
}

function sourceContent(source: SourceArtifact): string {
  const content = source.metadata.retrievedContent;
  return typeof content === "string" ? content : "";
}

function validateBundle(
  snapshot: TruthSnapshot,
  policy: KnowledgeEvidenceAdmissionPolicy,
): TruthBundle {
  const bundle = structuredClone(snapshot.bundle);
  const sourceById = new Map(bundle.sources.map((item) => [item.id, item]));
  const claimById = new Map(bundle.claims.map((item) => [item.id, item]));
  const qualifiedEvidence = bundle.claimEvidence.map((item) => {
    const claim = claimById.get(item.claimId);
    const source = sourceById.get(item.artifactId);
    if (!claim || !source) throw new Error("V36 qualification lost claim/source scope.");
    const proposed: RetrievedKnowledgeEvidence = {
      sourceId: source.id,
      relation: item.relation,
      excerpt: item.specificEvidence,
    };
    const disposition = policy.disposition({
      claim,
      source,
      sourceContent: sourceContent(source),
      proposed,
    });
    const admitted = disposition.admitted && disposition.verification === "VERIFIED";
    return {
      ...item,
      verification: disposition.verification,
      admitted,
      rejectionReason: admitted
        ? null
        : disposition.rejectionReason ?? "V36 did not admit this retrieved information.",
      provenanceComponentKey: disposition.provenanceComponentKey,
      provenanceConfidence: disposition.provenanceConfidence,
      authoritativePrimary: disposition.authoritativePrimary,
    };
  });
  const normalized = normalizeProvenanceState(
    bundle.runId,
    bundle.sources,
    bundle.sourceEdges,
    qualifiedEvidence,
    { sourceAuthority: "DERIVE_FROM_EVIDENCE" },
  );
  const obligationsByClaim = new Map<string, ProofObligation[]>();
  for (const obligation of bundle.obligations) {
    const entries = obligationsByClaim.get(obligation.claimId) ?? [];
    entries.push(obligation);
    obligationsByClaim.set(obligation.claimId, entries);
  }
  const evidenceByClaim = new Map<string, ClaimEvidence[]>();
  for (const item of normalized.evidence) {
    const entries = evidenceByClaim.get(item.claimId) ?? [];
    entries.push(item);
    evidenceByClaim.set(item.claimId, entries);
  }
  const checks = bundle.checks.map((check) => {
    const obligation = bundle.obligations.find((item) => item.id === check.obligationId);
    const admitted = obligation
      ? (evidenceByClaim.get(obligation.claimId) ?? []).filter((item) => item.admitted)
      : [];
    return {
      ...check,
      status: admitted.length > 0 ? "PASSED" as const : "UNRESOLVED" as const,
      evidenceIds: admitted.map((item) => item.externalEvidenceId),
      explanation: admitted.length > 0
        ? "V36 verified an exact source-bound report and preserved its provenance."
        : "No retrieved information passed V36 qualification for this obligation.",
    };
  });
  const checksByClaim = new Map<string, ProofCheck[]>();
  for (const check of checks) {
    const obligation = bundle.obligations.find((item) => item.id === check.obligationId);
    if (!obligation) continue;
    const entries = checksByClaim.get(obligation.claimId) ?? [];
    entries.push(check);
    checksByClaim.set(obligation.claimId, entries);
  }
  const assessments = bundle.claims.map((claim) => adjudicateClaim({
    assessmentId: bundle.assessments.find((item) => item.claimId === claim.id)?.id
      ?? stableTruthUuid(`${bundle.runId}:assessment:${claim.id}`),
    claim,
    obligations: obligationsByClaim.get(claim.id) ?? [],
    checks: checksByClaim.get(claim.id) ?? [],
    evidence: evidenceByClaim.get(claim.id) ?? [],
  }));
  return {
    ...bundle,
    provenanceComponents: normalized.components,
    sources: normalized.sources,
    claimEvidence: normalized.evidence,
    checks,
    assessments,
  };
}

/**
 * Request-aware V36 composition for Knowledge consultation. Acquisition is
 * operational and untrusted; investigate persists that boundary, while validate
 * is the only step that may admit evidence and produce assessments.
 */
export class KnowledgeAcquisitionTruthPipeline implements TruthExecutionPipeline {
  readonly mode = "v36-live-knowledge" as const;
  private readonly executionContractId: string;

  constructor(
    private readonly provider: KnowledgeAcquisitionProvider,
    private readonly admissionPolicy: KnowledgeEvidenceAdmissionPolicy = new ExactSourceReportAdmissionPolicy(),
  ) {
    if (!provider.kind.trim()) throw new Error("Knowledge acquisition provider kind must not be blank.");
    this.executionContractId = `v36-live-knowledge:${digest(stableStructuredJson({ providerKind: provider.kind }))}`;
  }

  private owns(snapshot: TruthSnapshot): void {
    assertTruthSnapshotIntegrity(snapshot);
    if (snapshot.executionContractId !== this.executionContractId) {
      throw new Error("Truth snapshot was produced by a different live knowledge execution contract.");
    }
  }

  async investigate(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineInvestigation> {
    if (!request || !isConsultationRunRequest(request)) {
      throw new Error("Live Knowledge acquisition requires an exact consultation request.");
    }
    const query = researchQuery(request);
    let bundle: TruthBundle;
    try {
      const acquired = sanitizeAcquisition(await this.provider.acquire({
        runId,
        objective: request.objective,
        context: request.context,
      }));
      bundle = investigatedBundle(runId, request, acquired);
    } catch {
      // Acquisition failure is an epistemic limitation, not permission to
      // manufacture an answer or leak provider/transport diagnostics.
      bundle = unavailableBundle(runId, query);
    }
    return {
      snapshot: createTruthSnapshot("INVESTIGATED", this.executionContractId, bundle),
      serialRounds: 1,
    };
  }

  async validate(snapshot: TruthSnapshot): Promise<TruthPipelineExecution> {
    this.owns(snapshot);
    if (snapshot.phase !== "INVESTIGATED") {
      throw new Error("Live Knowledge V36 validation requires an INVESTIGATED snapshot.");
    }
    const bundle = validateBundle(snapshot, this.admissionPolicy);
    const validated = createTruthSnapshot("VALIDATED", this.executionContractId, bundle);
    return { snapshot: validated, bundle: validated.bundle, serialRounds: 1 };
  }

  async beginDurableValidation(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep> {
    const execution = await this.validate(snapshot);
    return { kind: "VALIDATED", execution };
  }

  async resumeDurableValidation(
    _checkpoint: V36ResearchCheckpoint,
    _results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep> {
    throw new Error("Live Knowledge acquisition does not issue durable V36 continuation requests.");
  }

  async execute(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineExecution> {
    const investigation = await this.investigate(runId, request);
    return this.validate(investigation.snapshot);
  }
}
