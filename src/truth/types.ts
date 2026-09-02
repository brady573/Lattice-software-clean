export type ClaimType =
  | "FACTUAL"
  | "CAUSAL"
  | "QUANTITATIVE"
  | "CURRENT_STATE"
  | "INTERPRETIVE"
  | "AUTHENTICITY"
  | "OPINION";

export type MaterialVerdict =
  | "TRUE"
  | "FALSE"
  | "MISLEADING"
  | "UNVERIFIED"
  | "OUTDATED"
  | "OPINION"
  | "MIXED";

export type AtomicDisposition = "SUPPORTED" | "REFUTED" | "INSUFFICIENT" | "CONFLICT";
export type EvidenceRelation = "SUPPORTS" | "CONTRADICTS" | "CONTEXT" | "NEUTRAL";
export type ProofCheckStatus = "PENDING" | "PASSED" | "FAILED" | "UNRESOLVED";
export type SourceEdgeType = "CITES" | "DERIVES_FROM" | "SYNDICATES" | "COPIES" | "MIRRORS";
export type TruthConfidence = "HIGH" | "MODERATE" | "LOW";
export type ProvenanceConfidence = "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
export type EvidenceRisk = "ORDINARY" | "HIGH";
export type EvidenceVerification = "VERIFIED" | "UNVERIFIED" | "REJECTED";
export type ResearchPurpose =
  | "PRIMARY_SOURCE"
  | "SUPPORT"
  | "DISCONFIRM"
  | "INDEPENDENT_CORROBORATION"
  | "TEMPORAL_REFRESH"
  | "CONTRADICTION_VERIFY";

/** Explicit typed material qualifier not yet promoted to a dedicated claim field. */
export interface ClaimQualifier {
  key: string;
  value: string;
}

export interface CompiledClaim {
  id: string;
  runId: string;
  text: string;
  claimType: ClaimType;
  scope: string | null;
  effectiveAt: string | null;
  jurisdiction: string | null;
  unit: string | null;
  denominator: string | null;
  baseline: string | null;
  period: string | null;
  causalRelation: string | null;
  authenticityTarget: string | null;
  comparisonClass: string | null;
  quotedContext: string | null;
  qualifiers: ClaimQualifier[];
  evidenceRisk: EvidenceRisk;
}

export interface ProvenanceComponent {
  runId: string;
  key: string;
  canonicalOriginKey: string;
  confidence: ProvenanceConfidence;
}

export interface SourceArtifact {
  id: string;
  runId: string;
  canonicalUri: string;
  artifactHash: string;
  publisher: string | null;
  originKey: string | null;
  provenanceComponentKey: string | null;
  provenanceConfidence: ProvenanceConfidence;
  authoritativePrimary: boolean;
  retrievedAt: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentType: string;
  metadata: Record<string, unknown>;
  untrusted: true;
}

export interface SourceEdge {
  id: string;
  runId: string;
  fromArtifactId: string;
  toArtifactId: string;
  edgeType: SourceEdgeType;
  confidence: number;
  contentSimilarity: number | null;
}

export interface ResearchQuestion {
  id: string;
  runId: string;
  claimId: string;
  parentQuestionId: string | null;
  purpose: ResearchPurpose;
  query: string;
  serialRound: number;
}

export interface ClaimEvidence {
  id: string;
  runId: string;
  claimId: string;
  artifactId: string;
  externalEvidenceId: string;
  relation: EvidenceRelation;
  specificEvidence: string;
  provenanceComponentKey: string | null;
  provenanceConfidence: ProvenanceConfidence;
  authoritativePrimary: boolean;
  researchQuestionId: string | null;
  verification: EvidenceVerification;
  admitted: boolean;
  rejectionReason: string | null;
}

export interface ProofObligation {
  id: string;
  runId: string;
  claimId: string;
  kind: string;
  required: boolean;
}

export interface ProofCheck {
  id: string;
  runId: string;
  obligationId: string;
  kind: string;
  status: ProofCheckStatus;
  evidenceIds: string[];
  explanation: string | null;
}

export interface TruthAssessment {
  id: string;
  runId: string;
  claimId: string;
  atomicDisposition: AtomicDisposition;
  verdict: MaterialVerdict;
  confidence: TruthConfidence;
  admittedEvidenceIds: string[];
  contradictoryEvidenceIds: string[];
  unresolvedObligationIds: string[];
  rationale: string[];
}

export interface TruthBundle {
  runId: string;
  provenanceComponents: ProvenanceComponent[];
  researchQuestions: ResearchQuestion[];
  sources: SourceArtifact[];
  sourceEdges: SourceEdge[];
  claims: CompiledClaim[];
  claimEvidence: ClaimEvidence[];
  obligations: ProofObligation[];
  checks: ProofCheck[];
  assessments: TruthAssessment[];
}

export interface TruthEvidenceProfile {
  evidenceId: string;
  claimId: string;
  provenanceComponentKey: string | null;
  provenanceConfidence: ProvenanceConfidence;
  relation: EvidenceRelation;
  sourceAccepted: boolean;
  authoritativePrimary: boolean;
  verification: EvidenceVerification;
  researchQuestionId?: string | null;
}

export interface TruthClaimProfile {
  id: string;
  text: string;
  claimType: ClaimType;
  candidateId: string;
  criterion: string;
  evidenceIds: string[];
  scope?: string | null;
  effectiveAt?: string | null;
  jurisdiction?: string | null;
  unit?: string | null;
  denominator?: string | null;
  baseline?: string | null;
  period?: string | null;
  causalRelation?: string | null;
  authenticityTarget?: string | null;
  comparisonClass?: string | null;
  quotedContext?: string | null;
  qualifiers?: ClaimQualifier[];
  evidenceRisk?: EvidenceRisk;
  checks: Readonly<Record<string, ProofCheckStatus>>;
  materiallyMisleading?: boolean;
}

export interface TruthResearchProfile {
  id: string;
  claimId: string;
  parentQuestionId?: string | null;
  purpose: ResearchPurpose;
  query: string;
  serialRound: number;
}
