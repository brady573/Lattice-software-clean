import type { Candidate, Evidence, LatticeRunRequest } from "../domain.js";
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
 *
 * The exact Run request is optional for compatibility with existing fixture
 * providers, but canonical A3 projection uses it to bind candidate identities
 * to the authoritative USER objective rather than trusting acquisition output.
 */
export interface DecisionEvidenceProvider {
  projectDecisionEvidence(
    snapshot: TruthSnapshot,
    request?: LatticeRunRequest,
  ): Promise<DecisionEvidenceProjection>;
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
