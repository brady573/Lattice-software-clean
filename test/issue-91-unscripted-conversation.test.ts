import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

const compatibilityProposal: SolandraSemanticProposal = {
  objectiveRelation: "CONTINUE",
  proposedObjective: null,
  requestedHelp: "COGNITIVE_ASSISTANCE",
  relevantContext: [],
  entities: [],
  referents: [],
  constraints: [],
  preferences: [],
  knowledgeNeeds: [],
  materialAmbiguity: null,
  referencedKnowledgeId: null,
  referencedRecommendationId: null,
  referencedOptionId: null,
};

class ContextAwareConversationCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const priorSolandra = input.recentConversation?.filter((turn) => turn.role === "SOLANDRA").at(-1)?.content;
    const response = this.inputs.length === 1
      ? "Juniper feels memorable without sounding formal."
      : `Because I was building on my earlier point: ${priorSolandra ?? "no prior Solandra context arrived"}`;
    return {
      mode: "CONVERSATION",
      response,
      proposal: compatibilityProposal,
      invocationProvenance: {
        executionClass: null,
        routeMode: null,
        requestedProvider: null,
        requestedModel: "context-aware-conversation",
        actualProvider: "test",
        actualModel: "context-aware-conversation",
        brokerIdentity: null,
        brokerVersion: null,
        upstreamRequestId: null,
        routeProvenance: "COMPLETE",
      },
    };
  }
}

function memoryConfig() {
  return resolveRuntimeConfig({
    NODE_ENV: "test",
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-user",
  });
}

test("Issue #91 ordinary conversation uses prior Solandra context without creating governed state", async () => {
  const cognition = new ContextAwareConversationCognition();
  const app = await createRuntimeApp(memoryConfig(), { solandraCognition: cognition, memoryDispatchDelayMs: 1 });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json().conversation.id as string;

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "turn-1", message: "I need a playful name for a tiny garden robot. Give me one and one short reason." },
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.status, "CONVERSATION_COMPLETED");
    assert.equal(firstBody.interpretation.authority, "NON_AUTHORITATIVE_CONVERSATION");
    assert.equal(firstBody.interpretation.factualAuthority, false);
    assert.equal(firstBody.runId, undefined);
    assert.equal(firstBody.intentScopeId, undefined);
    assert.equal(firstBody.intentVersionId, undefined);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "turn-2", message: "Why that one? Keep it to one sentence." },
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    assert.equal(secondBody.status, "CONVERSATION_COMPLETED");
    assert.match(secondBody.presentation.assistantMessage, /Juniper feels memorable/u);
    assert.equal(cognition.inputs.length, 2);
    assert.deepEqual(cognition.inputs[1]?.recentConversation?.map((turn) => turn.role), ["USER", "SOLANDRA", "USER"]);
    assert.equal(cognition.inputs[1]?.recentConversation?.[1]?.content, firstBody.presentation.assistantMessage);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "turn-2", message: "Why that one? Keep it to one sentence." },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().presentation.assistantMessage, secondBody.presentation.assistantMessage);
    assert.equal(cognition.inputs.length, 2, "exact replay must reuse the persisted conversational response");

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200);
    const body = continuity.json();
    assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ["USER", "SOLANDRA", "USER", "SOLANDRA"]);
    assert.equal(body.messages[1].authority, "NON_AUTHORITATIVE_CONVERSATION");
    assert.equal(body.messages[1].factualAuthority, false);
    assert.deepEqual(body.runs, []);
    assert.deepEqual(body.knowledge, []);
    assert.deepEqual(body.recommendations, []);
    assert.deepEqual(body.acceptedChoices, []);
  } finally {
    await app.close();
  }
});
