import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { KnowledgeFinding, KnowledgeOutcome, RunOutcome } from "../src/outcome.js";
import {
  composeSolandraPresentation,
  hydrateSolandraResource,
} from "../src/presentation/solandra-presentation.js";

function finding(
  claimId: string,
  text: string,
  status: KnowledgeFinding["status"],
): KnowledgeFinding {
  return {
    claimId,
    text,
    status,
    confidence: "HIGH",
    evidenceIds: [`evidence-${claimId}`],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
  };
}

test("Issue #46: selected non-SUPPORTED findings preserve governed status instead of becoming established support", () => {
  const objective = "Draft a note asking whether a shared workspace is suitable for an evening meeting.";
  const knowledge: KnowledgeOutcome = {
    kind: "KNOWLEDGE",
    objective,
    acceptedUnderstanding: objective,
    findings: [
      finding("claim-supported", "The posted calendar lists the room as booked until 6 PM.", "SUPPORTED"),
      finding("claim-refuted", "The room is available all evening.", "REFUTED"),
      finding("claim-conflicted", "Evening building access is available without an escort.", "CONFLICTED"),
      finding("claim-unresolved", "The room can seat twenty people.", "UNRESOLVED"),
      finding("claim-sibling", "The lobby desk closes at 8 PM.", "SUPPORTED"),
    ],
    uncertainties: [],
    provenance: [],
    truthAssessmentIds: ["truth-workspace"],
  };
  const outcome: RunOutcome = {
    kind: "ACTION_PREPARATION",
    knowledge,
    resource: {
      kind: "PREPARED_MESSAGE",
      title: "Prepared message",
      body: "Could we use the shared workspace for our evening meeting?",
      draftAuthority: { origin: "SOLANDRA", factualAuthority: false, userAuthored: false },
      basis: [{
        knowledgeId: "knowledge-workspace",
        claimIds: ["claim-supported", "claim-refuted", "claim-conflicted", "claim-unresolved"],
      }],
      preservedUncertainties: ["Evening access remains conflicted and capacity remains unresolved."],
      editable: true,
      executionAuthorized: false,
    },
  };
  const run = {
    id: "46555555-5555-4555-8555-555555555555",
    conversationId: "conversation-status-presentation",
    status: "COMPLETED",
    version: 4,
    request: {
      kind: "consultation",
      objective,
      context: [],
      decisionNeed: "NONE",
      resourceNeed: "PREPARED_MESSAGE",
      sourceMessageId: "message-status-presentation",
      sourceMessageDigest: "c".repeat(64),
      intentVersion: 1,
      intentScopeId: "scope-status-presentation",
      intentVersionId: "intent-status-presentation",
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: ["truth-workspace"],
    events: [],
  } as unknown as LatticeRun;

  const snapshot = composeSolandraPresentation({
    conversationId: run.conversationId,
    run,
    outcome,
  });

  assert.deepEqual(
    snapshot.supportingKnowledge.map((entry) => [entry.id, entry.label, entry.value]),
    [
      ["knowledge:claim-supported", "SUPPORTED", "The posted calendar lists the room as booked until 6 PM."],
      ["knowledge:claim-refuted", "REFUTED", "The room is available all evening."],
      ["knowledge:claim-conflicted", "CONFLICTED", "Evening building access is available without an escort."],
      ["knowledge:claim-unresolved", "UNRESOLVED", "The room can seat twenty people."],
    ],
  );
  assert.equal(JSON.stringify(snapshot.supportingKnowledge).includes("claim-sibling"), false);

  const descriptor = snapshot.resources[0];
  assert.ok(descriptor);
  assert.deepEqual(descriptor.governedBasis, [{
    knowledgeId: "knowledge-workspace",
    claimIds: ["claim-supported", "claim-refuted", "claim-conflicted", "claim-unresolved"],
  }]);
  assert.equal("factualSupport" in descriptor, false);

  const hydrated = hydrateSolandraResource({ snapshot, resourceId: descriptor.id, run, outcome });
  assert.ok(hydrated && hydrated.payload.kind === "generated_artifact");
  if (!hydrated || hydrated.payload.kind !== "generated_artifact") return;
  assert.deepEqual(hydrated.payload.governedBasis, descriptor.governedBasis);
  assert.equal("factualSupport" in hydrated.payload, false);
  assert.deepEqual(hydrated.payload.preservedUncertainties, [
    "Evening access remains conflicted and capacity remains unresolved.",
  ]);
});
