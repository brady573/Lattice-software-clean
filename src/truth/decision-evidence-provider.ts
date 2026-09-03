import type { Candidate, Evidence } from "../domain.js";
import type { DecisionFixtureDataset } from "./fixture-dataset.js";
import { materializeDecisionEvidence, type AdmittedDecisionEvidence } from "./admission.js";
import { assertTruthSnapshotIntegrity, type TruthSnapshot } from "./snapshot.js";
import type { TruthBundle } from "./types.js";

export interface DecisionEvidenceProjection {
  candidates: Candidate[];
  evidence: Evidence[];
}

/**
 * Decision-specific projection behind validated V36 state. Generic truth
 * execution never depends on candidates, criteria, or this provider.
 */
export interface DecisionEvidenceProvider {
  projectDecisionEvidence(snapshot: TruthSnapshot): Promise<DecisionEvidenceProjection>;
}

export function materializeFixtureDecisionEvidence(
  dataset: DecisionFixtureDataset,
  bundle: TruthBundle,
): AdmittedDecisionEvidence[] {
  return materializeDecisionEvidence(dataset.evidence, bundle.claimEvidence, bundle.assessments);
}

export function createFixtureDecisionEvidenceProvider(
  datasetInput: DecisionFixtureDataset,
  ownsExecutionContract: (executionContractId: string) => boolean,
): DecisionEvidenceProvider {
  const dataset = structuredClone(datasetInput);
  return {
    async projectDecisionEvidence(snapshot) {
      assertTruthSnapshotIntegrity(snapshot);
      if (snapshot.phase !== "VALIDATED") {
        throw new Error("Decision evidence projection requires a VALIDATED V36 truth snapshot.");
      }
      if (!ownsExecutionContract(snapshot.executionContractId)) {
        throw new Error("Truth snapshot was produced by a different V36 execution contract.");
      }
      return {
        candidates: structuredClone(dataset.candidates),
        evidence: structuredClone(dataset.evidence),
      };
    },
  };
}
