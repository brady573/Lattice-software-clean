import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyTestApp as buildApp } from "../src/legacy/legacy-test-app.js";
import type { RunRequest } from "../src/domain.js";
import type { DecisionFixtureDataset } from "../src/truth/fixture-dataset.js";
import {
  createLegacyDecisionTruthComposition,
  laptopFixture,
} from "./fixtures/legacy-laptop-fixture.js";
import { createFixtureDecisionEvidenceProvider } from "../src/truth/decision-evidence-provider.js";
import { MemoryRunStore } from "../src/run-store.js";
import {
  OfflineFixtureTruthPipeline,
  type TruthExecutionPipeline,
} from "../src/truth/execution-pipeline.js";

const runId = "00000000-0000-4000-8000-000000001036";
const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function datasetWithUnverifiedNovaBattery(): DecisionFixtureDataset {
  return {
    ...structuredClone(laptopFixture),
    truthEvidence: laptopFixture.truthEvidence.map((profile) =>
      profile.evidenceId === "e-nova-battery"
        ? { ...profile, verification: "UNVERIFIED" as const }
        : structuredClone(profile),
    ),
  };
}

test("offline truth execution pipeline owns deterministic fixture evaluation", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  assert.equal(pipeline.mode, "v36-offline-fixture");
  const first = await pipeline.execute(runId);
  const second = await pipeline.execute(runId);

  assert.deepEqual(second, first);
  assert.equal(first.snapshot.phase, "VALIDATED");
  assert.equal(first.bundle.runId, runId);
  assert.equal(first.bundle.claims.length, 9);
  assert.equal("candidates" in first, false);
  assert.equal("evidence" in first, false);
  assert.equal("createDecisionEvidenceProvider" in pipeline, false);
  assert.equal(first.bundle.assessments.every((assessment) => assessment.verdict === "TRUE"), true);
});

test("V36 validates the exact investigation snapshot without reconstructing it", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate(runId);
  assert.equal(investigation.snapshot.phase, "INVESTIGATED");

  const validated = await pipeline.validate(structuredClone(investigation.snapshot));
  assert.equal(validated.snapshot.phase, "VALIDATED");
  assert.equal(validated.snapshot.executionContractId, investigation.snapshot.executionContractId);
  assert.deepEqual(await createFixtureDecisionEvidenceProvider(
    laptopFixture,
    (id) => pipeline.ownsExecutionContract(id),
  ).projectDecisionEvidence(validated.snapshot), {
    candidates: laptopFixture.candidates,
    evidence: laptopFixture.evidence,
  });

  const tampered = structuredClone(investigation.snapshot);
  const claim = tampered.bundle.claims[0];
  assert.ok(claim);
  claim.text = "tampered after snapshot creation";
  await assert.rejects(
    pipeline.validate(tampered),
    /bundle hash does not match/,
  );

  const wrongContract = structuredClone(investigation.snapshot);
  wrongContract.executionContractId = "different-v36-execution-contract";
  await assert.rejects(
    pipeline.validate(wrongContract),
    /different V36 execution contract/,
  );
});

test("offline truth execution pipeline snapshots fixture input against caller mutation", async () => {
  const dataset = structuredClone(laptopFixture);
  const pipeline = new OfflineFixtureTruthPipeline(dataset);
  const decisionEvidenceProvider = createFixtureDecisionEvidenceProvider(
    dataset,
    (id) => pipeline.ownsExecutionContract(id),
  );
  const novaPrice = dataset.evidence.find((item) => item.id === "e-nova-price");
  assert.ok(novaPrice);
  novaPrice.value = 9999;

  const result = await pipeline.execute(runId);
  const projection = await decisionEvidenceProvider.projectDecisionEvidence(result.snapshot);
  assert.equal(projection.evidence.find((item) => item.id === "e-nova-price")?.value, 1150);
});

test("application decision path consumes the injected V36 truth pipeline", async () => {
  const app = buildApp(createLegacyDecisionTruthComposition(datasetWithUnverifiedNovaBattery()));
  try {
    const response = await app.inject({ method: "POST", url: "/runs", payload: request });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.status, "COMPLETED");
    assert.equal(body.decision.outcome, "UNRESOLVED");
    assert.equal(body.decision.winnerCandidateId, undefined);
  } finally {
    await app.close();
  }
});

test("validation failure leaves the durable investigation snapshot intact", async () => {
  const store = new MemoryRunStore();
  const base = new OfflineFixtureTruthPipeline(laptopFixture);
  const failing: TruthExecutionPipeline = {
    mode: "v36-offline-fixture",
    investigate: (subjectRunId) => base.investigate(subjectRunId),
    validate: async () => { throw new Error("Injected validation failure"); },
    execute: async (subjectRunId) => base.execute(subjectRunId),
  };
  const app = buildApp({ runStore: store, truthPipeline: failing });
  try {
    const response = await app.inject({ method: "POST", url: "/runs", payload: request });
    assert.equal(response.statusCode, 422);
    const body = response.json();
    assert.match(body.message, /Injected validation failure/);
    assert.equal(typeof body.runId, "string");

    const run = await store.get(body.runId);
    assert.equal(run?.status, "FAILED");
    const snapshot = await store.getTruthSnapshot(body.runId);
    assert.ok(snapshot);
    assert.equal(snapshot.phase, "INVESTIGATED");
    assert.equal(snapshot.runId, body.runId);
  } finally {
    await app.close();
  }
});

test("truth execution pipeline rejects blank Run identity", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  await assert.rejects(() => pipeline.execute(" "), /runId must not be blank/);
});
