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
}

export interface OutcomeProvenance {
  sourceId: string;
  canonicalUri: string;
  publisher: string | null;
  provenanceConfidence: string;
  authoritativePrimary: boolean;
  retrievedAt: string;
}

export interface KnowledgeOutcome {
  kind: "KNOWLEDGE";
  objective: string;
  acceptedUnderstanding: string;
  findings: KnowledgeFinding[];
  uncertainties: string[];
  provenance: OutcomeProvenance[];
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

function findingStatus(disposition: TruthBundle["assessments"][number]["atomicDisposition"]): KnowledgeFindingStatus {
  switch (disposition) {
    case "SUPPORTED": return "SUPPORTED";
    case "REFUTED": return "REFUTED";
    case "CONFLICT": return "CONFLICTED";
    case "INSUFFICIENT": return "UNRESOLVED";
  }
}

export function buildKnowledgeOutcome(run: LatticeRun, truth: TruthBundle): KnowledgeOutcome {
  const claimsById = new Map(truth.claims.map((claim) => [claim.id, claim]));
  const findings = truth.assessments.flatMap<KnowledgeFinding>((assessment) => {
    const claim = claimsById.get(assessment.claimId);
    if (!claim) return [];
    return [{
      claimId: claim.id,
      text: claim.text,
      status: findingStatus(assessment.atomicDisposition),
      confidence: assessment.confidence,
      evidenceIds: [...assessment.admittedEvidenceIds],
      contradictoryEvidenceIds: [...assessment.contradictoryEvidenceIds],
      temporalQualifiers: {
        effectiveAt: claim.effectiveAt,
        period: claim.period,
      },
    }];
  });

  const uncertainties = findings
    .filter((finding) => finding.status === "UNRESOLVED" || finding.status === "CONFLICTED")
    .map((finding) => `${finding.status}: ${finding.text}`);
  if (findings.length === 0) {
    uncertainties.push("No validated external findings are available for this consultation yet.");
  }

  return {
    kind: "KNOWLEDGE",
    objective: runObjective(run.request),
    acceptedUnderstanding: runObjective(run.request),
    findings,
    uncertainties,
    provenance: truth.sources.map((source) => ({
      sourceId: source.id,
      canonicalUri: source.canonicalUri,
      publisher: source.publisher,
      provenanceConfidence: source.provenanceConfidence,
      authoritativePrimary: source.authoritativePrimary,
      retrievedAt: source.retrievedAt,
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
