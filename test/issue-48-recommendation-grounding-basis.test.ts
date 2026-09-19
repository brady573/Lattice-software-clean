import assert from "node:assert/strict";
import test from "node:test";
import type { IntentVersion } from "../src/intent/types.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import {
  ModelSolandraAdvisoryRuntime,
  type SolandraAdvisoryInput,
} from "../src/solandra/advisory.js";

const FIXED_TIME = "2026-09-10T23:50:00.000Z";
const DECLARED_FINDING = "Approach A has the lower documented maintenance burden.";
const UNDECLARED_SIBLING_FINDING = "Approach B has a documented 40% lower operating cost.";

const INTENT: IntentVersion = {
  intentScopeId: "consultation:issue-48",
  intentVersionId: "intent-issue-48-v1",
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: "transition-issue-48-v1",
  lineageKind: "INITIAL",
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: "VALUE", value: "Choose the easier approach to maintain." },
      provenance: {
        kind: "EXPLICIT_USER",
        logicalUserTurnId: "turn-issue-48",
        sourceMessageId: "message-issue-48",
        sourceDigest: "b".repeat(64),
      },
    },
    requirements: {},
    preferences: {},
  },
  createdAt: FIXED_TIME,
};

function advisoryInput(): SolandraAdvisoryInput {
  return {
    conversationId: "issue-48",
    userMessageId: "message-issue-48",
    authoritativeIntent: INTENT,
    authoritativeObjective: "Choose the easier approach to maintain.",
    userContext: [],
    knowledge: [{
      knowledgeId: "knowledge-issue-48",
      objective: "Choose the easier approach to maintain.",
      findings: [
        {
          claimId: "claim-declared",
          text: DECLARED_FINDING,
          status: "SUPPORTED",
          confidence: "HIGH",
        },
        {
          claimId: "claim-undeclared-sibling",
          text: UNDECLARED_SIBLING_FINDING,
          status: "SUPPORTED",
          confidence: "HIGH",
        },
      ],
      uncertainties: ["The maintenance comparison is based on the currently governed evidence."],
      asOf: FIXED_TIME,
    }],
  };
}

class ExactBasisGroundingProvider implements ModelProvider {
  readonly kind = "issue-48-exact-basis-provider";
  calls = 0;
  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const text = JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Prefer approach A because it has a documented 40% lower operating cost.",
        basis: [{ knowledgeId: "knowledge-issue-48", claimIds: ["claim-declared"] }],
        rationale: ["The lower operating cost makes it the better fit."],
        tradeoffs: [],
        assumptions: [],
        uncertainties: ["The maintenance comparison is based on the currently governed evidence."],
        alternatives: [],
      });
    return {
      response: {
        id: `issue-48-${this.calls}`,
        model: request.model,
        output: [{ type: "text", text }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `issue-48-${this.calls}`,
      },
    };
  }

}

test("Issue #48: single-pass Recommendation retains only exact declared claim basis", async () => {
  const provider = new ExactBasisGroundingProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(
    new ModelRuntime(provider),
    "issue-48-model",
  );

  const result = await runtime.advise(advisoryInput());

  assert.equal(provider.calls, 1);
  assert.equal(result.result.status, "RECOMMENDATION");
  if (result.result.status !== "RECOMMENDATION") return;
  assert.deepEqual(result.result.basis, [{
    knowledgeId: "knowledge-issue-48",
    claimIds: ["claim-declared"],
  }]);
});
