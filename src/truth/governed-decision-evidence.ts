import { isConsultationRunRequest, type Candidate, type Evidence, type LatticeRunRequest } from "../domain.js";
import {
  ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
  ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_VERSION,
  parseAlphaNpmDecisionSemantics,
} from "../decision/alpha-decision-capability.js";
import type { DecisionEvidenceProjection, DecisionEvidenceProvider } from "./decision-evidence-provider.js";
import { assertTruthSnapshotIntegrity, type TruthSnapshot } from "./snapshot.js";
import type { CompiledClaim, TruthAssessment } from "./types.js";

function qualifier(claim: CompiledClaim, key: string): string | undefined {
  return claim.qualifiers.find((item) => item.key === key)?.value;
}

function projectedCount(claim: CompiledClaim): number | null {
  const raw = qualifier(claim, "computed-runtime-dependency-count");
  if (raw === undefined || !/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const expected = `declares ${value} runtime ${value === 1 ? "dependency" : "dependencies"} in npm registry metadata.`;
  return claim.text.includes(expected) ? value : null;
}

function assessmentFor(snapshot: TruthSnapshot, claimId: string): TruthAssessment | undefined {
  return snapshot.bundle.assessments.find((item) => item.claimId === claimId);
}

function assertSupportedDecisionRequest(request: LatticeRunRequest | undefined): asserts request is Extract<LatticeRunRequest, { kind: "consultation" }> {
  if (!request || !isConsultationRunRequest(request) || request.decisionNeed !== "QUALIFIED" || !request.decisionInput) {
    throw new Error("Canonical decision evidence projection requires the exact QUALIFIED consultation Run request.");
  }
  const criteria = new Set([
    ...request.decisionInput.hardRequirements.map((item) => `${item.criterionId}@${item.criterionVersion}`),
    ...request.decisionInput.priorities.map((item) => `${item.criterionId}@${item.criterionVersion}`),
  ]);
  if (
    criteria.size === 0
    || [...criteria].some((item) => item !== `${ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID}@${ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_VERSION}`)
  ) {
    throw new Error("The bounded Alpha decision evidence projection received unsupported criterion semantics.");
  }
}

/**
 * Project only V36-TRUE npm dependency-count claims into the existing Decision
 * Engine shape. Candidate identity comes from the exact authoritative objective,
 * never from provider/model metadata. Missing, conflicting, or non-TRUE values
 * remain missing and therefore preserve the engine's insufficient-evidence path.
 */
export class GovernedKnowledgeDecisionEvidenceProvider implements DecisionEvidenceProvider {
  async projectDecisionEvidence(
    snapshot: TruthSnapshot,
    request?: LatticeRunRequest,
  ): Promise<DecisionEvidenceProjection> {
    assertTruthSnapshotIntegrity(snapshot);
    if (snapshot.phase !== "VALIDATED") {
      throw new Error("Decision evidence projection requires a VALIDATED V36 truth snapshot.");
    }
    assertSupportedDecisionRequest(request);
    const semantics = parseAlphaNpmDecisionSemantics(request.objective);
    if (!semantics) {
      throw new Error("The qualified decision objective is outside the bounded Alpha npm decision capability.");
    }

    const candidates: Candidate[] = semantics.candidates.map((packageName) => ({
      id: packageName,
      label: packageName,
      attributes: {},
    }));
    const evidence: Evidence[] = [];

    for (const packageName of semantics.candidates) {
      const qualified = snapshot.bundle.claims.flatMap((claim) => {
        if (
          qualifier(claim, "decision-criterion") !== ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID
          || qualifier(claim, "npm-package") !== packageName
        ) return [];
        const assessment = assessmentFor(snapshot, claim.id);
        if (!assessment || assessment.verdict !== "TRUE") return [];
        const value = projectedCount(claim);
        if (value === null) return [];
        const links = snapshot.bundle.claimEvidence.filter((item) =>
          item.claimId === claim.id
          && item.relation === "SUPPORTS"
          && item.admitted
          && item.verification === "VERIFIED"
          && assessment.admittedEvidenceIds.includes(item.externalEvidenceId)
        );
        return links.map((link) => ({ claim, assessment, link, value }));
      });

      const values = [...new Set(qualified.map((item) => item.value))];
      if (values.length !== 1) continue;
      const selected = qualified.sort((left, right) => left.link.externalEvidenceId.localeCompare(right.link.externalEvidenceId))[0];
      if (!selected) continue;
      const source = snapshot.bundle.sources.find((item) => item.id === selected.link.artifactId);
      if (!source) continue;
      evidence.push({
        id: selected.link.externalEvidenceId,
        candidateId: packageName,
        criterion: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
        value: values[0]!,
        sourceId: source.id,
        sourceLabel: typeof source.metadata.title === "string" ? source.metadata.title : source.canonicalUri,
        admitted: false,
        rejectionReason: null,
      });
    }

    return { candidates, evidence };
  }
}
