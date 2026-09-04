import {
  isConsultationRunRequest,
  runObjective,
  type ConsultationRunRequest,
  type LatticeRun,
  type StructuredDecision,
} from "./domain.js";
import type { TruthBundle, TruthConfidence } from "./truth/types.js";

export type KnowledgeFindingStatus = "SUPPORTED" | "REFUTED" | "CONFLICTED" | "UNRESOLVED";

export interface KnowledgeFinding {
  claimId: string;
  text: string;
  status: KnowledgeFindingStatus;
  confidence: TruthConfidence;
  evidenceIds: string[];
  contradictoryEvidenceIds: string[];
  temporalQualifiers: {
    effectiveAt: string | null;
    period: string | null;
  };
  rationale?: string[];
  basis?: "SOURCE_REPORT" | "CLAIM";
}

export interface OutcomeProvenance {
  sourceId: string;
  canonicalUri: string;
  title?: string;
  publisher: string | null;
  provenanceConfidence: string;
  authoritativePrimary: boolean;
  retrievedAt: string;
  publishedAt?: string | null;
}

export interface KnowledgeEvidence {
  evidenceId: string;
  claimId: string;
  sourceId: string;
  relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT" | "NEUTRAL";
  excerpt: string;
  verification: "VERIFIED" | "UNVERIFIED" | "REJECTED";
  admitted: boolean;
  rejectionReason: string | null;
}

export interface KnowledgeOutcome {
  kind: "KNOWLEDGE";
  objective: string;
  acceptedUnderstanding: string;
  findings: KnowledgeFinding[];
  uncertainties: string[];
  provenance: OutcomeProvenance[];
  evidence?: KnowledgeEvidence[];
  truthAssessmentIds: string[];
}

export interface PreparedResource {
  kind: "CHECKLIST" | "PREPARED_MESSAGE";
  title: string;
  body: string;
  editable: true;
  executionAuthorized: false;
}

export interface ActionPreparationOutcome {
  kind: "ACTION_PREPARATION";
  knowledge: KnowledgeOutcome;
  resource: PreparedResource;
}

export interface DecisionSupportOutcome {
  kind: "DECISION_SUPPORT";
  knowledge: KnowledgeOutcome;
  decision: StructuredDecision;
  explanation: string | null;
  selectionAuthorized: false;
}

export type RunOutcome = KnowledgeOutcome | DecisionSupportOutcome | ActionPreparationOutcome;

function findingStatus(assessment: TruthBundle["assessments"][number]): KnowledgeFindingStatus {
  if (assessment.atomicDisposition === "CONFLICT") return "CONFLICTED";
  if (assessment.verdict === "UNVERIFIED") return "UNRESOLVED";
  switch (assessment.atomicDisposition) {
    case "SUPPORTED": return "SUPPORTED";
    case "REFUTED": return "REFUTED";
    case "CONFLICT": return "CONFLICTED";
    case "INSUFFICIENT": return "UNRESOLVED";
  }
}

function followUpCapabilityLimitations(run: LatticeRun): string[] {
  if (!isConsultationRunRequest(run.request)) return [];
  const latest = run.request.context.at(-1)?.trim() ?? "";
  if (!latest) return [];

  const limitations: string[] = [];
  const simplificationRequested = /\b(?:simpler|simply|plain language)\b/iu.test(latest);
  if (simplificationRequested) {
    limitations.push(
      "This v0.1 Knowledge path does not perform genuine language simplification; it preserves source-grounded wording rather than treating truncation as simplification.",
    );
  } else if (/^why\??$/iu.test(latest) || /\b(?:explain|tell me more)\b/iu.test(latest)) {
    limitations.push(
      "This v0.1 follow-up uses additional source-grounded retrieval only; it does not produce a model-synthesized explanation.",
    );
  }

  if (/\b(?:disagree|disagrees|contradict|contradiction|conflict|conflicting)\b/iu.test(latest)) {
    limitations.push(
      "This v0.1 Knowledge path does not perform semantic contradiction detection. Retrieved evidence may contain explicit contradictions, but ordinary retrieval is not treated as proof that disagreement was searched or absent.",
    );
  }

  return limitations;
}

export function buildKnowledgeOutcome(run: LatticeRun, truth: TruthBundle): KnowledgeOutcome {
  const claimsById = new Map(truth.claims.map((claim) => [claim.id, claim]));
  const findings = truth.assessments.flatMap<KnowledgeFinding>((assessment) => {
    const claim = claimsById.get(assessment.claimId);
    if (!claim) return [];

    const admittedSupportingEvidenceIds = truth.claimEvidence
      .filter(
        (item) =>
          item.claimId === assessment.claimId
          && item.admitted
          && item.verification === "VERIFIED"
          && item.relation === "SUPPORTS",
      )
      .map((item) => item.externalEvidenceId);

    return [{
      claimId: claim.id,
      text: claim.text,
      status: findingStatus(assessment),
      confidence: assessment.confidence,
      evidenceIds: admittedSupportingEvidenceIds,
      contradictoryEvidenceIds: [...assessment.contradictoryEvidenceIds],
      temporalQualifiers: {
        effectiveAt: claim.effectiveAt,
        period: claim.period,
      },
      rationale: [...assessment.rationale],
      basis: claim.qualifiers.some((item) => item.key === "source-report") ? "SOURCE_REPORT" : "CLAIM",
    }];
  });

  const uncertainties = findings
    .filter((finding) => finding.status === "UNRESOLVED" || finding.status === "CONFLICTED")
    .map((finding) => `${finding.status}: ${finding.text}`);
  if (findings.length === 0) {
    uncertainties.push("No validated external findings are available for this consultation yet.");
  }
  if (findings.some((finding) => finding.basis === "SOURCE_REPORT")) {
    uncertainties.push(
      "Source-report evidence establishes only what the retrieved sources report; it does not independently verify broader real-world claims or satisfy unresolved V36 proof obligations.",
    );
  }
  uncertainties.push(...followUpCapabilityLimitations(run));

  return {
    kind: "KNOWLEDGE",
    objective: runObjective(run.request),
    acceptedUnderstanding: runObjective(run.request),
    findings,
    uncertainties,
    provenance: truth.sources.map((source) => ({
      sourceId: source.id,
      canonicalUri: source.canonicalUri,
      title: typeof source.metadata.title === "string" ? source.metadata.title : source.canonicalUri,
      publisher: source.publisher,
      provenanceConfidence: source.provenanceConfidence,
      authoritativePrimary: source.authoritativePrimary,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
    })),
    evidence: truth.claimEvidence.map((item) => ({
      evidenceId: item.externalEvidenceId,
      claimId: item.claimId,
      sourceId: item.artifactId,
      relation: item.relation,
      excerpt: item.specificEvidence,
      verification: item.verification,
      admitted: item.admitted,
      rejectionReason: item.rejectionReason,
    })),
    truthAssessmentIds: truth.assessments.map((assessment) => assessment.id),
  };
}

function prepareResource(request: ConsultationRunRequest, knowledge: KnowledgeOutcome): PreparedResource | undefined {
  if (request.resourceNeed === "NONE") return undefined;
  if (request.resourceNeed === "PREPARED_MESSAGE") {
    return {
      kind: "PREPARED_MESSAGE",
      title: "Prepared message",
      body: [
        `Objective: ${knowledge.objective}`,
        "",
        knowledge.findings.length > 0
          ? knowledge.findings.map((finding) => `- ${finding.status}: ${finding.text}`).join("\n")
          : "- No externally validated findings are available yet.",
        "",
        "Please review and edit this message before sending it.",
      ].join("\n"),
      editable: true,
      executionAuthorized: false,
    };
  }
  return {
    kind: "CHECKLIST",
    title: "Prepared checklist",
    body: [
      `Objective: ${knowledge.objective}`,
      "- Review supported and refuted findings.",
      "- Resolve material conflicts or unresolved items.",
      "- Confirm the intended action before executing anything consequential.",
    ].join("\n"),
    editable: true,
    executionAuthorized: false,
  };
}

export function buildRunOutcome(run: LatticeRun, truth: TruthBundle): RunOutcome {
  const knowledge = buildKnowledgeOutcome(run, truth);
  if (run.decision) {
    return {
      kind: "DECISION_SUPPORT",
      knowledge,
      decision: structuredClone(run.decision),
      explanation: run.explanation,
      selectionAuthorized: false,
    };
  }
  if (isConsultationRunRequest(run.request)) {
    const resource = prepareResource(run.request, knowledge);
    if (resource) return { kind: "ACTION_PREPARATION", knowledge, resource };
  }
  return knowledge;
}
