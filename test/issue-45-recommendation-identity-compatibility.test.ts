import assert from "node:assert/strict";
import test from "node:test";
import { recommendationOptions } from "../src/recommendation/recommendation-options.js";
import { buildRecommendationRecord } from "../src/recommendation/recommendation-store.js";

const FIXED_TIME = "2026-09-12T14:30:00.000Z";

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

test("Issue #45: adding exact USER premise lineage does not change run Recommendation or option identity", () => {
  const previousShape = build();
  const candidateShape = build([
    "intent-issue-45-identity-v1",
    "message-issue-45-identity",
  ]);

  assert.equal(candidateShape.recommendationId, previousShape.recommendationId);
  assert.deepEqual(recommendationOptions(candidateShape), recommendationOptions(previousShape));
  assert.deepEqual(candidateShape.premiseAuthority.user, [{
    intentVersionId: "intent-issue-45-identity-v1",
    sourceMessageId: "message-issue-45-identity",
  }]);
});
