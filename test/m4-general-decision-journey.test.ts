import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import type { SolandraAdvisoryInput, SolandraAdvisoryRuntime, SolandraAdvisoryRuntimeResult } from "../src/solandra/advisory.js";
import type { SolandraCognitionInput, SolandraCognitionResult, SolandraCognitiveRuntime, SolandraSemanticProposal } from "../src/solandra/cognition.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE", routeMode: "PINNED", requestedProvider: "m4-fixture", requestedModel: "m4-fixture-model",
  actualProvider: "m4-fixture", actualModel: "m4-fixture-model", brokerIdentity: null, brokerVersion: null,
  upstreamRequestId: "m4-fixture", routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE", proposedObjective: null, requestedHelp: "DECISION", relevantContext: [], entities: [], referents: [],
    constraints: [], preferences: [], knowledgeNeeds: [], materialAmbiguity: null, referencedKnowledgeId: null,
    referencedRecommendationId: null, referencedOptionId: null, ...overrides,
  };
}

class GeneralDecisionCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const recommendation = input.governedRecommendations?.at(-1);
    if (/more about/iu.test(input.message)) {
      return { proposal: proposal({ requestedHelp: "EXPLAIN_OPTION", referencedRecommendationId: recommendation?.recommendationId ?? null, referencedOptionId: recommendation?.options[1]?.optionId ?? null }), invocationProvenance: PROVENANCE };
    }
    if (/go with/iu.test(input.message)) {
      return { proposal: proposal({ requestedHelp: "ACCEPT_CHOICE", referencedRecommendationId: recommendation?.recommendationId ?? null, referencedOptionId: recommendation?.options[1]?.optionId ?? null }), invocationProvenance: PROVENANCE };
    }
    return { proposal: proposal({ objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE", proposedObjective: input.currentObjective ? null : input.message, preferences: ["keep upkeep light"] }), invocationProvenance: PROVENANCE };
  }
}

class UserMaterialAdvisory implements SolandraAdvisoryRuntime {
  calls: SolandraAdvisoryInput[] = [];
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls.push(structuredClone(input));
    return {
      result: {
        status: "RECOMMENDATION", recommendation: "Use a lightweight weekly review.", basis: [],
        rationale: ["It directly matches the USER preference for lower upkeep."], tradeoffs: ["Less structure may mean occasional manual cleanup."],
        assumptions: ["keeping upkeep light"], uncertainties: [], preservedUncertainties: [],
        alternatives: ["Keep the current ad-hoc approach.", "Use a structured daily review."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m4-user",
} as NodeJS.ProcessEnv);

const FIRST_MESSAGE = "Help me choose a simple way to review my rough project notes; I care most about keeping upkeep light.";

test("ordinary USER-value decision reaches durable Solandra-originated advisory Recommendation without formal run/Decision Engine and preserves option choice", async () => {
  const advisory = new UserMaterialAdvisory();
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: new GeneralDecisionCognition(), solandraAdvisory: advisory });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json().conversation.id as string;
    const first = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "m4-turn-1", message: FIRST_MESSAGE } });
    assert.equal(first.statusCode, 200, first.body);
    const firstBody = first.json();
    assert.equal(firstBody.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(firstBody.interpretation.requestedHelp, "DECISION");
    assert.equal(firstBody.recommendationReference.selectionAuthorized, false);
    assert.equal(firstBody.recommendationReference.options.length, 3);
    assert.equal(firstBody.recommendationReference.options[0].text, "Use a lightweight weekly review.");
    assert.equal(advisory.calls.length, 1);
    assert.deepEqual(advisory.calls[0]?.knowledge, []);

    let continuity = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json();
    assert.equal(continuity.runs.length, 0, "ordinary USER-material advice must not force a formal/Truth Run");
    assert.equal(continuity.recommendations.length, 1);
    assert.equal(continuity.recommendations[0].runId, null);
    assert.deepEqual(continuity.recommendations[0].knowledgeIds, []);
    assert.equal(continuity.acceptedChoices.length, 0);

    const explain = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "m4-turn-2", message: "Tell me more about the second option." } });
    assert.equal(explain.statusCode, 200, explain.body);
    assert.equal(explain.json().status, "OPTION_REFERENCE_RESOLVED");
    const optionId = explain.json().optionReference.optionId;
    assert.equal(optionId, firstBody.recommendationReference.options[1].optionId);

    const choose = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "m4-turn-3", message: "I'll go with that one." } });
    assert.equal(choose.statusCode, 200, choose.body);
    const choice = choose.json().acceptedChoice;
    assert.equal(choose.json().status, "ACCEPTED_CHOICE_ESTABLISHED");
    assert.equal(choice.optionId, optionId);
    assert.equal(choice.recommendationId, firstBody.recommendationReference.recommendationId);
    assert.equal(choice.authorizationGranted, false);
    assert.equal(choice.executionAuthorized, false);

    continuity = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json();
    assert.equal(continuity.acceptedChoices.length, 1);
    assert.equal(continuity.acceptedChoices[0].sourceMessageId, choice.sourceMessageId);
    assert.deepEqual(continuity.messages.map((message: { content: string }) => message.content), [
      FIRST_MESSAGE,
      "Tell me more about the second option.",
      "I'll go with that one.",
    ]);
  } finally { await app.close(); }
});

class AmbiguousCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return { proposal: proposal({ objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE", proposedObjective: input.currentObjective ? null : input.message, materialAmbiguity: { question: "Do you mean the lower-cost option now or the lower-effort option over time?", couldChangeObjective: true } }), invocationProvenance: PROVENANCE };
  }
}

test("material decision ambiguity clarifies without fabricating Recommendation or choice", async () => {
  const advisory = new UserMaterialAdvisory();
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: new AmbiguousCognition(), solandraAdvisory: advisory });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json().conversation.id as string;
    const response = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "ambiguous-1", message: "Which one is better for me?" } });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(response.json().status, "NEEDS_CLARIFICATION");
    assert.equal(advisory.calls.length, 0);
    const continuity = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json();
    assert.equal(continuity.recommendations.length, 0);
    assert.equal(continuity.acceptedChoices.length, 0);
  } finally { await app.close(); }
});
