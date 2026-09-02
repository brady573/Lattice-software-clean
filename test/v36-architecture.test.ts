import assert from "node:assert/strict";
import test from "node:test";
import type { FixtureDataset } from "../src/fixtures.js";
import { laptopFixture } from "../src/fixtures.js";
import { createDecisionFromAdmittedEvidence } from "../src/engine.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { independentSupportComponents, deriveProvenanceComponentMap, recoverOriginalArtifact } from "../src/truth/provenance.js";
import { recomputeRatio, percentagePointChange, relativePercentChange, quantitativeCompatibility } from "../src/truth/numerical.js";
import { buildFalsificationRequest, buildContradictionVerificationRequest, runSelectiveFalsification } from "../src/truth/falsification.js";
import { buildCorroborationRequest, recoverIndependentCorroboration } from "../src/truth/corroboration.js";
import { executeEvidencePlan } from "../src/truth/orchestrator.js";
import {
  DormantLiveResearchProvider,
  OfflineFixtureResearchAdmissionPolicy,
  OfflineFixtureResearchProvider,
  type ResearchEvidenceCandidate,
  type ResearchEvidenceDisposition,
} from "../src/truth/pipeline.js";
import { assertTruthBundleIntegrity } from "../src/truth/invariants.js";
import { assertExplanationTruthFidelity, renderCanonicalExplanation } from "../src/truth/fidelity.js";
import type { ClaimEvidence, ClaimType, CompiledClaim, ProofCheckStatus, SourceArtifact, SourceEdge } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000136";

function passedChecks(claimType: ClaimType): Record<string, ProofCheckStatus> {
  return Object.fromEntries(requiredProofObligations(claimType).map((kind) => [kind, "PASSED"]));
}

function datasetForClaim(options: {
  claimType: ClaimType;
  relations: Array<"SUPPORTS" | "CONTRADICTS">;
  components: Array<string | null>;
  primary?: boolean[];
  verification?: Array<"VERIFIED" | "UNVERIFIED" | "REJECTED">;
  checks?: Record<string, ProofCheckStatus>;
  materiallyMisleading?: boolean;
}): FixtureDataset {
  const evidenceItems = options.relations.map((_, index) => ({
    id: `e-${index}`,
    candidateId: "candidate",
    criterion: "criterion",
    value: 1,
    sourceId: `source-${index}`,
    sourceLabel: `source ${index}`,
    admitted: true,
  }));
  return {
    candidates: [{ id: "candidate", label: "Candidate" }],
    evidence: evidenceItems,
    truthClaims: [{
      id: "claim",
      text: "material claim",
      claimType: options.claimType,
      candidateId: "candidate",
      criterion: "criterion",
      evidenceIds: evidenceItems.map((item) => item.id),
      scope: "candidate",
      unit: options.claimType === "QUANTITATIVE" ? "units" : null,
      denominator: options.claimType === "QUANTITATIVE" ? "candidate" : null,
      baseline: options.claimType === "QUANTITATIVE" ? "baseline" : null,
      period: options.claimType === "QUANTITATIVE" ? "period" : null,
      causalRelation: options.claimType === "CAUSAL" ? "causes" : null,
      authenticityTarget: options.claimType === "AUTHENTICITY" ? "artifact" : null,
      evidenceRisk: "ORDINARY",
      checks: options.checks ?? passedChecks(options.claimType),
      materiallyMisleading: options.materiallyMisleading ?? false,
    }],
    truthEvidence: evidenceItems.map((item, index) => ({
      evidenceId: item.id,
      claimId: "claim",
      provenanceComponentKey: options.components[index] ?? null,
      provenanceConfidence: options.components[index] ? "HIGH" : "UNKNOWN",
      relation: options.relations[index] ?? "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: options.primary?.[index] ?? false,
      verification: options.verification?.[index] ?? "VERIFIED",
    })),
  };
}

function claim(claimType: ClaimType = "CAUSAL"): CompiledClaim {
  return {
    id: "claim-1",
    runId,
    text: "A causes B",
    claimType,
    scope: "prototype",
    effectiveAt: null,
    jurisdiction: null,
    unit: null,
    denominator: null,
    baseline: null,
    period: null,
    causalRelation: claimType === "CAUSAL" ? "causes" : null,
    authenticityTarget: claimType === "AUTHENTICITY" ? "artifact" : null,
    comparisonClass: null,
    quotedContext: null,
    qualifiers: [],
    evidenceRisk: "ORDINARY",
  };
}

function evidence(
  id: string,
  relation: "SUPPORTS" | "CONTRADICTS",
  component: string | null,
  verification: "VERIFIED" | "UNVERIFIED" | "REJECTED" = "VERIFIED",
): ClaimEvidence {
  return {
    id: `ce-${id}`,
    runId,
    claimId: "claim-1",
    artifactId: `artifact-${id}`,
    externalEvidenceId: id,
    relation,
    specificEvidence: id,
    provenanceComponentKey: component,
    provenanceConfidence: component ? "HIGH" : "UNKNOWN",
    authoritativePrimary: false,
    researchQuestionId: null,
    verification,
    admitted: verification !== "REJECTED",
    rejectionReason: verification === "REJECTED" ? "rejected" : null,
  };
}

function researchCandidate(
  id: string,
  relation: "SUPPORTS" | "CONTRADICTS",
): ResearchEvidenceCandidate {
  return {
    artifactId: `artifact-${id}`,
    externalEvidenceId: id,
    relation,
    specificEvidence: id,
  };
}

function researchDisposition(
  component: string | null,
  verification: "VERIFIED" | "UNVERIFIED" | "REJECTED" = "VERIFIED",
): ResearchEvidenceDisposition {
  const admitted = verification !== "REJECTED";
  return {
    verification,
    admitted,
    rejectionReason: admitted ? null : "rejected",
    provenanceComponentKey: component,
    provenanceConfidence: component ? "HIGH" : "UNKNOWN",
    authoritativePrimary: false,
  };
}

function artifact(id: string, component: string): SourceArtifact {
  return {
    id,
    runId,
    canonicalUri: `fixture://${id}`,
    artifactHash: `hash-${id}`,
    publisher: "fixture",
    originKey: id,
    provenanceComponentKey: component,
    provenanceConfidence: "HIGH",
    authoritativePrimary: false,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "text/plain",
    metadata: {},
    untrusted: true,
  };
}

test("claim-centric aggregation lets two independent sources satisfy one causal claim", () => {
  const result = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "CAUSAL",
    relations: ["SUPPORTS", "SUPPORTS"],
    components: ["origin-a", "origin-b"],
  }));
  assert.equal(result.bundle.claims.length, 1);
  assert.equal(result.bundle.claimEvidence.length, 2);
  assert.equal(result.assessments[0]?.verdict, "TRUE");
  assert.equal(result.decisionEvidence.filter((item) => item.admitted).length, 2);
});

test("same-origin repetition and false consensus do not satisfy independent corroboration", () => {
  const result = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "CAUSAL",
    relations: ["SUPPORTS", "SUPPORTS"],
    components: ["shared-origin", "shared-origin"],
  }));
  assert.equal(result.assessments[0]?.verdict, "UNVERIFIED");
  assert.equal(independentSupportComponents(result.bundle.claimEvidence).size, 1);
});

test("verified conflict is MIXED before positive-burden release", () => {
  const result = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "CAUSAL",
    relations: ["SUPPORTS", "CONTRADICTS"],
    components: ["origin-a", "origin-b"],
  }));
  assert.equal(result.assessments[0]?.verdict, "MIXED");
});

test("unknown provenance and rejected evidence fail closed for positive release", () => {
  const unknown = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "FACTUAL",
    relations: ["SUPPORTS"],
    components: [null],
    primary: [true],
  }));
  assert.equal(unknown.assessments[0]?.verdict, "UNVERIFIED");

  const rejected = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "FACTUAL",
    relations: ["SUPPORTS"],
    components: ["origin-a"],
    primary: [true],
    verification: ["REJECTED"],
  }));
  assert.equal(rejected.assessments[0]?.verdict, "UNVERIFIED");
  assert.equal(rejected.decisionEvidence.some((item) => item.admitted), false);
});

test("current-state staleness is OUTDATED and context omission is MISLEADING", () => {
  const currentChecks = passedChecks("CURRENT_STATE");
  currentChecks.TEMPORAL_APPLICABILITY = "FAILED";
  const outdated = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "CURRENT_STATE",
    relations: ["SUPPORTS"],
    components: ["origin-a"],
    primary: [true],
    checks: currentChecks,
  }));
  assert.equal(outdated.assessments[0]?.verdict, "OUTDATED");

  const misleading = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "INTERPRETIVE",
    relations: ["SUPPORTS"],
    components: ["origin-a"],
    primary: [true],
    materiallyMisleading: true,
  }));
  assert.equal(misleading.assessments[0]?.verdict, "MISLEADING");
});

test("causal confounding and authenticity gaps cannot be released as TRUE", () => {
  const causalChecks = passedChecks("CAUSAL");
  causalChecks.ALTERNATIVE_EXPLANATIONS = "FAILED";
  const causal = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "CAUSAL",
    relations: ["SUPPORTS", "SUPPORTS"],
    components: ["origin-a", "origin-b"],
    checks: causalChecks,
  }));
  assert.equal(causal.assessments[0]?.verdict, "UNVERIFIED");

  const authenticity = evaluateFixtureTruth(runId, datasetForClaim({
    claimType: "AUTHENTICITY",
    relations: ["SUPPORTS"],
    components: ["origin-a"],
    primary: [true],
  }));
  assert.equal(authenticity.assessments[0]?.verdict, "UNVERIFIED");
});

test("provenance graph collapses derivative sources and recovers the original", () => {
  const derivative = artifact("derivative", "derivative-chain");
  const original = artifact("original", "original-chain");
  const edge: SourceEdge = {
    id: "edge-1",
    runId,
    fromArtifactId: derivative.id,
    toArtifactId: original.id,
    edgeType: "SYNDICATES",
    confidence: 0.99,
    contentSimilarity: 0.98,
  };
  const map = deriveProvenanceComponentMap([derivative, original], [edge]);
  assert.equal(map.get(derivative.id), map.get(original.id));
  assert.equal(recoverOriginalArtifact(derivative.id, [derivative, original], [edge])?.id, original.id);
});

test("quantitative discipline preserves denominator, baseline, period and change semantics", () => {
  assert.deepEqual(
    quantitativeCompatibility(
      { value: 5, unit: "%", denominator: "all-users", baseline: "2025", period: "Q1" },
      { value: 5, unit: "%", denominator: "active-users", baseline: "2024", period: "Q2" },
    ).failures,
    ["DENOMINATOR", "BASELINE", "TIME_PERIOD"],
  );
  assert.equal(recomputeRatio(1, 4, 100), 25);
  assert.equal(percentagePointChange(20, 25), 5);
  assert.equal(relativePercentChange(20, 25), 25);
});

test("selective falsification verifies blocking contradictions", async () => {
  const subject = claim("CAUSAL");
  const initial = [evidence("support-a", "SUPPORTS", "origin-a")];
  const disconfirm = buildFalsificationRequest(subject, 1);
  const verify = buildContradictionVerificationRequest(subject, disconfirm.id, 2);
  const provider = new OfflineFixtureResearchProvider(
    {
      [disconfirm.id]: { artifacts: [], edges: [], evidence: [researchCandidate("counter", "CONTRADICTS")] },
      [verify.id]: { artifacts: [], edges: [], evidence: [researchCandidate("counter", "CONTRADICTS")] },
    },
    new OfflineFixtureResearchAdmissionPolicy({
      [disconfirm.id]: { counter: researchDisposition("origin-b", "UNVERIFIED") },
      [verify.id]: { counter: researchDisposition("origin-b", "VERIFIED") },
    }),
  );
  const result = await runSelectiveFalsification(subject, initial, provider, 1);
  assert.equal(result.serialRounds, 2);
  assert.equal(result.verifiedContradictions.length, 1);
});

test("bounded corroboration recovery stops on a second independent origin", async () => {
  const subject = claim("CAUSAL");
  const initial = [evidence("support-a", "SUPPORTS", "origin-a")];
  const request = buildCorroborationRequest(subject, 1);
  const provider = new OfflineFixtureResearchProvider(
    {
      [request.id]: { artifacts: [], edges: [], evidence: [researchCandidate("support-b", "SUPPORTS")] },
    },
    new OfflineFixtureResearchAdmissionPolicy({
      [request.id]: { "support-b": researchDisposition("origin-b") },
    }),
  );
  const result = await recoverIndependentCorroboration(subject, initial, provider, 2, 1);
  assert.equal(result.state.reason, "SATISFIED");
  assert.equal(result.probesUsed, 1);
});

test("parallel evidence orchestration respects dependencies, retries, and terminal failure", async () => {
  let attempts = 0;
  const plan = await executeEvidencePlan([
    { id: "support", dependsOn: [], execute: async () => "support" },
    { id: "counter", dependsOn: [], execute: async () => "counter" },
    {
      id: "retry",
      dependsOn: [],
      maxAttempts: 2,
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return "retry-ok";
      },
    },
    { id: "decide", dependsOn: ["support", "counter", "retry"], execute: async () => "decide" },
  ]);
  assert.equal(plan.serialRounds, 3);
  assert.equal(plan.results.get("retry")?.attempts, 2);
  assert.equal(plan.results.get("decide")?.completedRound, 3);
  await assert.rejects(
    executeEvidencePlan([{ id: "broken", dependsOn: [], maxAttempts: 1, execute: async () => { throw new Error("terminal"); } }]),
    /failed after 1 attempt/,
  );
});

test("offline provider enforces scope and live research remains dormant", async () => {
  const crossScope = {
    ...researchCandidate("cross", "SUPPORTS"),
    runId: "00000000-0000-4000-8000-000000000999",
    claimId: "claim-1",
  } as ResearchEvidenceCandidate;
  const offline = new OfflineFixtureResearchProvider({
    q: { artifacts: [], edges: [], evidence: [crossScope] },
  });
  await assert.rejects(
    offline.research({ id: "q", runId, claimId: "claim-1", parentQuestionId: null, purpose: "SUPPORT", query: "q", serialRound: 1 }),
    /crossed Run or claim scope/,
  );
  const live = new DormantLiveResearchProvider();
  await assert.rejects(
    live.research({ id: "q", runId, claimId: "claim-1", parentQuestionId: null, purpose: "SUPPORT", query: "q", serialRound: 1 }),
    /dormant during the V36 prototype stage/,
  );
});

test("same-Run integrity and explanation fidelity fail closed", () => {
  const truth = evaluateFixtureTruth(runId, laptopFixture);
  assertTruthBundleIntegrity(truth.bundle);
  const corrupted = structuredClone(truth.bundle);
  const firstClaim = corrupted.claims[0];
  assert.ok(firstClaim);
  firstClaim.runId = "00000000-0000-4000-8000-000000000999";
  assert.throws(() => assertTruthBundleIntegrity(corrupted), /cross-Run state/);

  const decision = createDecisionFromAdmittedEvidence(
    {
      goal: "Choose",
      hardConstraints: [
        { criterion: "price", operator: "lte", value: 1300 },
        { criterion: "batteryHours", operator: "gte", value: 12 },
      ],
      priorities: [{ criterion: "performance", weight: 1 }],
    },
    laptopFixture.candidates,
    truth.decisionEvidence,
    truth.assessments.map((assessment) => assessment.id),
  );
  const canonical = renderCanonicalExplanation(decision, laptopFixture.candidates);
  assert.doesNotThrow(() => assertExplanationTruthFidelity(canonical, decision, laptopFixture.candidates, truth.bundle));
  assert.throws(
    () => assertExplanationTruthFidelity(`${canonical} Unsupported extra fact.`, decision, laptopFixture.candidates, truth.bundle),
    /diverges from the persisted StructuredDecision/,
  );
});