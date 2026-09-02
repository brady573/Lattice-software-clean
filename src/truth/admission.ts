import type { Evidence } from "../domain.js";
import type { ClaimEvidence, TruthAssessment } from "./types.js";

const admittedDecisionEvidenceBrand: unique symbol = Symbol("lattice.v36.admitted-decision-evidence");

/**
 * Decision-layer evidence that has crossed the V36 material-admission boundary.
 *
 * The private runtime brand prevents raw provider/fixture evidence from being
 * passed directly into decision scoring merely by setting `admitted: true`.
 * Rejected and unresolved evidence remains represented in structured truth
 * state, but is not materialized as positive decision evidence.
 */
export type AdmittedDecisionEvidence = Omit<Evidence, "admitted" | "rejectionReason"> & {
  readonly admitted: true;
  readonly [admittedDecisionEvidenceBrand]: true;
};

function brandAdmittedDecisionEvidence(item: Evidence): AdmittedDecisionEvidence {
  const { admitted: _legacyAdmission, rejectionReason: _rejectionReason, ...rest } = item;
  return Object.freeze({
    ...rest,
    admitted: true as const,
    [admittedDecisionEvidenceBrand]: true as const,
  });
}

/**
 * Fail closed if a caller attempts to bypass V36 by supplying structurally
 * similar raw evidence directly to the decision engine.
 */
export function assertAdmittedDecisionEvidence(
  evidence: readonly unknown[],
): asserts evidence is readonly AdmittedDecisionEvidence[] {
  for (const item of evidence) {
    if (
      typeof item !== "object"
      || item === null
      || (item as Record<PropertyKey, unknown>)[admittedDecisionEvidenceBrand] !== true
    ) {
      throw new Error("Decision evidence did not originate from the V36 material-admission boundary.");
    }
  }
}

export function materializeDecisionEvidence(
  evidence: Evidence[],
  claimEvidence: ClaimEvidence[],
  assessments: TruthAssessment[],
): AdmittedDecisionEvidence[] {
  const assessmentByClaim = new Map(assessments.map((assessment) => [assessment.claimId, assessment]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  for (const assessment of assessments.filter((item) => item.verdict === "TRUE")) {
    const material = assessment.admittedEvidenceIds.flatMap((id) => {
      const item = evidenceById.get(id);
      return item ? [item] : [];
    });
    const first = material[0];
    if (!first) continue;
    for (const item of material.slice(1)) {
      if (
        item.candidateId !== first.candidateId
        || item.criterion !== first.criterion
        || JSON.stringify(item.value) !== JSON.stringify(first.value)
      ) {
        throw new Error(`Material TRUE assessment ${assessment.id} contains inconsistent decision values.`);
      }
    }
  }

  const admittedExternalIds = new Set<string>();
  for (const link of claimEvidence) {
    const assessment = assessmentByClaim.get(link.claimId);
    const admitted = assessment?.verdict === "TRUE"
      && assessment.admittedEvidenceIds.includes(link.externalEvidenceId)
      && link.admitted
      && link.verification === "VERIFIED";
    if (admitted) admittedExternalIds.add(link.externalEvidenceId);
  }

  return evidence.flatMap((item) =>
    admittedExternalIds.has(item.id) ? [brandAdmittedDecisionEvidence(item)] : []
  );
}
