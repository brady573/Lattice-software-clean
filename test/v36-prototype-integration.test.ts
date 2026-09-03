import assert from "node:assert/strict";
import test from "node:test";
import type { FixtureDataset } from "../src/truth/fixture-dataset.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { buildCorroborationRequest } from "../src/truth/corroboration.js";
import { buildFalsificationRequest } from "../src/truth/falsification.js";
import {
  OfflineFixtureResearchAdmissionPolicy,
  OfflineFixtureResearchProvider,
  type ResearchEvidenceCandidate,
} from "../src/truth/pipeline.js";
import { runPrototypeResearch } from "../src/truth/research-controller.js";
import type { ClaimEvidence, CompiledClaim, ProofCheckStatus } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000236";

function passed(claimType: "CAUSAL"): Record<string, ProofCheckStatus> {
  return Object.fromEntries(requiredProofObligations(claimType).map((kind) => [kind, "PASSED"]));
}

function causalClaim(): CompiledClaim {
  return {
    id: "claim-causal",
    runId,
    text: "A causes B",
    claimType: "CAUSAL",
    scope: "prototype",
    effectiveAt: null,
    jurisdiction: null,
    unit: null,
    denominator: null,
    baseline: null,
    period: null,
    causalRelation: "causes",
    authenticityTarget: null,
    comparisonClass: null,
    quotedContext: null,
    qualifiers: [],
    evidenceRisk: "ORDINARY",
  };
}

function linkedEvidence(
  id: string,
  component: string,
  relation: "SUPPORTS" | "CONTRADICTS" = "SUPPORTS",
  verification: "VERIFIED" | "UNVERIFIED" = "VERIFIED",
): ClaimEvidence {
  return {
    id: `ce-${id}`,
    runId,
    claimId: "claim-causal",
    artifactId: `artifact-${id}`,
    externalEvidenceId: id,
    relation,
    specificEvidence: id,
    provenanceComponentKey: component,
    provenanceConfidence: "HIGH",
    authoritativePrimary: false,
    researchQuestionId: null,
    verification,
    admitted: true,
    rejectionReason: null,
  };
}

function researchCandidate(id: string): ResearchEvidenceCandidate {
  return {
    artifactId: `artifact-${id}`,
    externalEvidenceId: id,
    relation: "SUPPORTS",
    specificEvidence: id,
  };
}

test("source graph collapse is applied before end-to-end positive-burden adjudication", () => {
  const dataset: FixtureDataset = {
    evidence: [
      { id: "e-a", value: true, sourceId: "wire-copy", sourceLabel: "Wire copy", admitted: true },
      { id: "e-b", value: true, sourceId: "original", sourceLabel: "Original source", admitted: true },
    ],
    truthClaims: [{
      id: "claim",
      text: "A causes B",
      claimType: "CAUSAL",
      candidateId: "candidate",
      criterion: "effect",
      evidenceIds: ["e-a", "e-b"],
      causalRelation: "causes",
      evidenceRisk: "ORDINARY",
      checks: passed("CAUSAL"),
    }],
    truthEvidence: [
      { evidenceId: "e-a", claimId: "claim", provenanceComponentKey: "raw-copy", provenanceConfidence: "HIGH", relation: "SUPPORTS", sourceAccepted: true, authoritativePrimary: true, verification: "VERIFIED" },
      { evidenceId: "e-b", claimId: "claim", provenanceComponentKey: "raw-original", provenanceConfidence: "HIGH", relation: "SUPPORTS", sourceAccepted: true, authoritativePrimary: true, verification: "VERIFIED" },
    ],
    truthSourceEdges: [{
      fromSourceId: "wire-copy",
      toSourceId: "original",
      edgeType: "SYNDICATES",
      confidence: 0.99,
      contentSimilarity: 0.99,
    }],
  };

  const result = evaluateFixtureTruth(runId, dataset);
  const components = new Set(result.bundle.claimEvidence.map((item) => item.provenanceComponentKey));
  assert.equal(components.size, 1);
  assert.equal(result.bundle.provenanceComponents.length, 1);
  assert.equal(result.assessments[0]?.verdict, "UNVERIFIED");
  const copy = result.bundle.claimEvidence.find((item) => item.externalEvidenceId === "e-a");
  const original = result.bundle.claimEvidence.find((item) => item.externalEvidenceId === "e-b");
  assert.equal(copy?.authoritativePrimary, false);
  assert.equal(original?.authoritativePrimary, true);
});

test("prototype research runs falsification and corroboration in parallel and reports critical-path rounds", async () => {
  const claim = causalClaim();
  const initial = [linkedEvidence("support-a", "origin-a")];
  const falsification = buildFalsificationRequest(claim, 1);
  const corroboration = buildCorroborationRequest(claim, 1);
  const provider = new OfflineFixtureResearchProvider(
    {
      [falsification.id]: { artifacts: [], edges: [], evidence: [] },
      [corroboration.id]: { artifacts: [], edges: [], evidence: [researchCandidate("support-b")] },
    },
    new OfflineFixtureResearchAdmissionPolicy({
      [corroboration.id]: {
        "support-b": {
          verification: "VERIFIED",
          admitted: true,
          rejectionReason: null,
          provenanceComponentKey: "origin-b",
          provenanceConfidence: "HIGH",
          authoritativePrimary: false,
        },
      },
    }),
  );

  const result = await runPrototypeResearch(claim, initial, provider, 2);
  assert.equal(result.serialCriticalPathRounds, 1);
  assert.equal(result.researchQuestions.length, 2);
  assert.equal(new Set(result.evidence.filter((item) => item.relation === "SUPPORTS").map((item) => item.provenanceComponentKey)).size, 2);
});
