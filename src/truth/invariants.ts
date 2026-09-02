import type { TruthBundle } from "./types.js";

export function assertTruthBundleIntegrity(bundle: TruthBundle): void {
  const runScoped = [
    ...bundle.provenanceComponents,
    ...bundle.researchQuestions,
    ...bundle.sources,
    ...bundle.sourceEdges,
    ...bundle.claims,
    ...bundle.claimEvidence,
    ...bundle.obligations,
    ...bundle.checks,
    ...bundle.assessments,
  ];
  for (const item of runScoped) {
    if (item.runId !== bundle.runId) {
      throw new Error(`Truth bundle contains cross-Run state: expected ${bundle.runId}, received ${item.runId}.`);
    }
  }

  const sourceIds = new Set(bundle.sources.map((item) => item.id));
  const componentKeys = new Set(bundle.provenanceComponents.map((item) => item.key));
  const claimIds = new Set(bundle.claims.map((item) => item.id));
  const researchIds = new Set(bundle.researchQuestions.map((item) => item.id));
  const obligationIds = new Set(bundle.obligations.map((item) => item.id));
  const externalEvidenceIds = new Set(bundle.claimEvidence.map((item) => item.externalEvidenceId));

  for (const source of bundle.sources) {
    if (source.provenanceComponentKey && !componentKeys.has(source.provenanceComponentKey)) {
      throw new Error(`Source ${source.id} references unknown provenance component ${source.provenanceComponentKey}.`);
    }
  }
  for (const edge of bundle.sourceEdges) {
    if (!sourceIds.has(edge.fromArtifactId) || !sourceIds.has(edge.toArtifactId)) {
      throw new Error(`Source edge ${edge.id} references an artifact outside the bundle.`);
    }
  }
  for (const question of bundle.researchQuestions) {
    if (!claimIds.has(question.claimId)) throw new Error(`Research question ${question.id} references unknown claim.`);
    if (question.parentQuestionId && !researchIds.has(question.parentQuestionId)) {
      throw new Error(`Research question ${question.id} references unknown parent question.`);
    }
  }
  for (const evidence of bundle.claimEvidence) {
    if (!claimIds.has(evidence.claimId) || !sourceIds.has(evidence.artifactId)) {
      throw new Error(`Claim evidence ${evidence.id} references state outside the bundle.`);
    }
    if (evidence.provenanceComponentKey && !componentKeys.has(evidence.provenanceComponentKey)) {
      throw new Error(`Claim evidence ${evidence.id} references unknown provenance component.`);
    }
    if (evidence.researchQuestionId && !researchIds.has(evidence.researchQuestionId)) {
      throw new Error(`Claim evidence ${evidence.id} references unknown research question.`);
    }
  }
  for (const obligation of bundle.obligations) {
    if (!claimIds.has(obligation.claimId)) throw new Error(`Proof obligation ${obligation.id} references unknown claim.`);
  }
  for (const check of bundle.checks) {
    if (!obligationIds.has(check.obligationId)) throw new Error(`Proof check ${check.id} references unknown obligation.`);
    for (const evidenceId of check.evidenceIds) {
      if (!externalEvidenceIds.has(evidenceId)) throw new Error(`Proof check ${check.id} references unknown evidence ${evidenceId}.`);
    }
  }
  for (const assessment of bundle.assessments) {
    if (!claimIds.has(assessment.claimId)) throw new Error(`Truth assessment ${assessment.id} references unknown claim.`);
    for (const evidenceId of [...assessment.admittedEvidenceIds, ...assessment.contradictoryEvidenceIds]) {
      if (!externalEvidenceIds.has(evidenceId)) {
        throw new Error(`Truth assessment ${assessment.id} references unknown evidence ${evidenceId}.`);
      }
    }
    for (const obligationId of assessment.unresolvedObligationIds) {
      if (!obligationIds.has(obligationId)) {
        throw new Error(`Truth assessment ${assessment.id} references unknown obligation ${obligationId}.`);
      }
    }
  }
}
