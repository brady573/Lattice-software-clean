import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { DurableDecisionPlan } from "../src/intent/decision-plan-store.js";
import {
  composeSolandraPresentation,
  hydrateSolandraResource,
} from "../src/presentation/solandra-presentation.js";

const plan: DurableDecisionPlan = {
  decisionPlanId: "decision-plan:run-1",
  runId: "run-1",
  intentScopeId: "scope-1",
  intentVersionId: "intent-version-1",
  planningMaterial: {
    goal: "Choose a laptop for development work",
    hardConstraints: [
      { criterion: "price", operator: "lte", value: 1300 },
      { criterion: "batteryHours", operator: "gte", value: 12 },
    ],
    priorities: [{ criterion: "performance", weight: 1 }],
  },
  boundAt: "2026-08-30T14:00:00.000Z",
};

function run(status: LatticeRun["status"]): LatticeRun {
  return {
    id: "run-1",
    conversationId: "conversation-1",
    status,
    version: status === "COMPLETED" ? 8 : 3,
    request: structuredClone(plan.planningMaterial),
    decision: status === "COMPLETED"
      ? {
          goal: plan.planningMaterial.goal,
          winnerCandidateId: "candidate-a",
          evaluations: [],
          rationale: ["Candidate A satisfies the hard requirements and best serves the accepted priority."],
          evidenceIds: ["evidence-1"],
          truthAssessmentIds: ["truth-1"],
        }
      : null,
    explanation: status === "COMPLETED" ? "Candidate A is the supported recommendation." : null,
    truthAssessmentIds: status === "COMPLETED" ? ["truth-1"] : [],
    events: [],
  };
}

test("presentation is reconstructed from accepted Product state rather than transcript prose", () => {
  const listening = composeSolandraPresentation({ conversationId: "conversation-1" });
  assert.equal(listening.phase, "listening");
  assert.equal(listening.durableUnderstanding, undefined);
  assert.deepEqual(listening.supportingKnowledge, []);

  const understanding = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
  });
  assert.equal(understanding.phase, "understanding");
  assert.equal(understanding.durableUnderstanding?.goal, plan.planningMaterial.goal);
  assert.deepEqual(understanding.durableUnderstanding?.requirements, plan.planningMaterial.hardConstraints);
  assert.deepEqual(understanding.durableUnderstanding?.preferences, plan.planningMaterial.priorities);
  assert.equal(understanding.nextAction, undefined);
  assert.equal(JSON.stringify(understanding).includes("Candidate A is the supported recommendation"), false);
});

test("knowledge gaps remain uncertainty and cannot manufacture an actionable winner", () => {
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("AWAITING_CLARIFICATION"),
    decisionPlan: plan,
  });
  assert.equal(snapshot.phase, "knowledge_gap");
  assert.equal(snapshot.materialUncertainty.length, 1);
  assert.equal(snapshot.nextAction, undefined);
  assert.deepEqual(snapshot.resources, []);
});

test("only StructuredDecision supplies winner authority for actionable presentation", () => {
  const completed = run("COMPLETED");
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    decisionPlan: plan,
  });

  assert.equal(snapshot.phase, "actionable");
  assert.equal(snapshot.nextAction?.winnerCandidateId, completed.decision?.winnerCandidateId);
  assert.deepEqual(snapshot.nextAction?.provenance[0], {
    authority: "structured_decision",
    ref: completed.id,
  });
  assert.equal(snapshot.resources.length, 2);
  assert.ok(snapshot.resources.every((resource) =>
    resource.capabilities.every((capability) => ["copy", "download", "play", "open_external", "show_location"].includes(capability)),
  ));
});

test("Solandra preserves a non-winner decision outcome and frontier", () => {
  const completed = run("COMPLETED");
  const { winnerCandidateId: _winnerCandidateId, ...withoutWinner } = completed.decision!;
  completed.decision = {
    ...withoutWinner,
    outcome: "FRONTIER",
    frontierCandidateIds: ["candidate-a", "candidate-b"],
    tiedCandidateIds: [],
    materialUnknowns: ["battery@1"],
  };
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    decisionPlan: plan,
  });
  assert.equal(snapshot.phase, "actionable");
  assert.equal(snapshot.nextAction?.outcome, "FRONTIER");
  assert.equal(snapshot.nextAction?.winnerCandidateId, undefined);
  assert.deepEqual(snapshot.nextAction?.frontierCandidateIds, ["candidate-a", "candidate-b"]);
  assert.deepEqual(snapshot.nextAction?.materialUnknowns, ["battery@1"]);
});

test("presentation revisions are deterministic and transitions distinguish reconnect from update", () => {
  const first = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
  });
  const reconnected = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
    knownRevision: first.presentationRevision,
  });
  assert.equal(reconnected.presentationRevision, first.presentationRevision);
  assert.equal(reconnected.transition, "reconnected");

  const updated = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("COMPLETED"),
    decisionPlan: plan,
    knownRevision: first.presentationRevision,
  });
  assert.notEqual(updated.presentationRevision, first.presentationRevision);
  assert.equal(updated.transition, "updated");
});

test("resource hydration is application-owned and bound to descriptors from the current snapshot", () => {
  const completed = run("COMPLETED");
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    decisionPlan: plan,
  });
  const criteria = snapshot.resources.find((resource) => resource.kind === "text");
  const rationale = snapshot.resources.find((resource) => resource.kind === "generated_artifact");
  assert.ok(criteria);
  assert.ok(rationale);

  const criteriaResource = hydrateSolandraResource({
    snapshot,
    resourceId: criteria.id,
    run: completed,
    decisionPlan: plan,
  });
  assert.equal(criteriaResource?.payload.kind, "text");
  if (criteriaResource?.payload.kind === "text") {
    assert.match(criteriaResource.payload.text, /Requirement — price/);
    assert.match(criteriaResource.payload.text, /Preference — performance/);
  }

  const rationaleResource = hydrateSolandraResource({
    snapshot,
    resourceId: rationale.id,
    run: completed,
    decisionPlan: plan,
  });
  assert.equal(rationaleResource?.payload.kind, "generated_artifact");
  if (rationaleResource?.payload.kind === "generated_artifact") {
    assert.match(rationaleResource.payload.text, /Winner: candidate-a/);
    assert.equal(rationaleResource.payload.filename, "solandra-decision-run-1.txt");
  }
  assert.equal(hydrateSolandraResource({ snapshot, resourceId: "model-script", run: completed, decisionPlan: plan }), undefined);
});
