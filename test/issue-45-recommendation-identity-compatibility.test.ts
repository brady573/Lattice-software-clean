import assert from "node:assert/strict";
import test from "node:test";
import { recommendationOptions } from "../src/recommendation/recommendation-options.js";
import { buildRecommendationRecord } from "../src/recommendation/recommendation-store.js";

const FIXED_TIME = "2026-09-12T14:30:00.000Z";
const USER_PREMISE = [{
  intentVersionId: "intent-issue-45-identity-v1",
  sourceMessageId: "message-issue-45-identity",
}];

function build(
  recommendedProposal = "Prefer option A.",
  userMaterialBasis?: string[],
) {
  return buildRecommendationRecord({
    conversationId: "issue-45-identity",
    runId: "run-issue-45-identity",
    intentScopeId: "consultation:issue-45-identity",
    intentVersionId: "intent-issue-45-identity-v1",
    sourceMessageId: "message-issue-45-identity",
    basis: [{ knowledgeId: "knowledge-issue-45-identity", claimIds: ["claim-identity"] }],
    ...(userMaterialBasis ? { userMaterialBasis } : {}),
    recommendedProposal,
    alternativeProposals: ["Option B"],
    rationale: ["Advisory judgment over the declared premise."],
    tradeoffs: [],
    assumptions: [],
    uncertainties: [],
    createdAt: FIXED_TIME,
  });
}

test("Issue #45: exact USER premise projection preserves run Recommendation identity", () => {
  const withoutExplicitUserMaterial = build();
  const withExactUserMaterial = build("Prefer option A.", [
    "intent-issue-45-identity-v1",
    "message-issue-45-identity",
  ]);

  assert.equal(withExactUserMaterial.recommendationId, withoutExplicitUserMaterial.recommendationId);
  assert.deepEqual(withoutExplicitUserMaterial.premiseAuthority.user, USER_PREMISE);
  assert.deepEqual(withExactUserMaterial.premiseAuthority.user, USER_PREMISE);
});

test("Issue #45: V2 proposal identity is stable independently of arbitrary proposal wording", () => {
  const original = build("Prefer option A.", [
    "intent-issue-45-identity-v1",
    "message-issue-45-identity",
  ]);
  const reworded = build("Choose option A for now.", [
    "intent-issue-45-identity-v1",
    "message-issue-45-identity",
  ]);

  assert.equal(reworded.recommendationId, original.recommendationId);
  assert.deepEqual(
    recommendationOptions(reworded).map((option) => option.optionId),
    recommendationOptions(original).map((option) => option.optionId),
  );
  assert.notDeepEqual(
    recommendationOptions(reworded).map((option) => option.text),
    recommendationOptions(original).map((option) => option.text),
  );
});
