import assert from "node:assert/strict";
import test from "node:test";
import { recommendationOptions } from "../src/recommendation/recommendation-options.js";
import { buildRecommendationRecord } from "../src/recommendation/recommendation-store.js";

const FIXED_TIME = "2026-09-12T14:30:00.000Z";
const USER_PREMISE = [{
  intentVersionId: "intent-issue-45-identity-v1",
  sourceMessageId: "message-issue-45-identity",
}];

function build(userMaterialBasis?: string[]) {
  return buildRecommendationRecord({
    conversationId: "issue-45-identity",
    runId: "run-issue-45-identity",
    intentScopeId: "consultation:issue-45-identity",
    intentVersionId: "intent-issue-45-identity-v1",
    sourceMessageId: "message-issue-45-identity",
    basis: [{ knowledgeId: "knowledge-issue-45-identity", claimIds: ["claim-identity"] }],
    ...(userMaterialBasis ? { userMaterialBasis } : {}),
    recommendation: "Prefer option A.",
    rationale: ["Advisory judgment over the declared premise."],
    tradeoffs: [],
    assumptions: [],
    uncertainties: [],
    alternatives: ["Option B"],
    createdAt: FIXED_TIME,
  });
}

test("Issue #45: exact USER premise projection preserves historical run Recommendation and option identity", () => {
  const historicalShape = build();
  const candidateShape = build([
    "intent-issue-45-identity-v1",
    "message-issue-45-identity",
  ]);

  assert.equal(candidateShape.recommendationId, historicalShape.recommendationId);
  assert.deepEqual(recommendationOptions(candidateShape), recommendationOptions(historicalShape));
  assert.deepEqual(historicalShape.premiseAuthority.user, USER_PREMISE);
  assert.deepEqual(candidateShape.premiseAuthority.user, USER_PREMISE);
});
