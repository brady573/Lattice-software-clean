import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreparedResourceRecord,
  preparedResourceFromRecord,
} from "../src/action-preparation/prepared-resource-store.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelInvocationProvenance,
  ModelProviderResult,
} from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraAdvisoryInput,
  SolandraAdvisoryRuntime,
  SolandraAdvisoryRuntimeResult,
} from "../src/solandra/advisory.js";
import {
  ModelSolandraCognitiveRuntime,
  type SolandraCognitionInput,
  type SolandraCognitionResult,
  type SolandraCognitiveRuntime,
  type SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-91-state-presentation",
  requestedModel: "issue-91-state-presentation",
  actualProvider: "issue-91-state-presentation",
  actualModel: "issue-91-state-presentation",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-91-state-presentation-request",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal>): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "DECISION",
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
    ...overrides,
  };
}

class StateDrivenCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const recommendation = input.governedRecommendations?.at(-1);
    if (recommendation) {
      assert.equal(recommendation.selectionAuthorized, false);
      const recommended = recommendation.options.find((option) => option.recommended);
      assert.ok(recommended);
      return {
        mode: "GOVERNED",
        proposal: proposal({
          requestedHelp: "ACCEPT_CHOICE",
          referencedRecommendationId: recommendation.recommendationId,
          referencedOptionId: recommended.optionId,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      mode: "GOVERNED",
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        requestedHelp: "DECISION",
        preferences: ["finish the quicker chore first"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class StateDrivenAdvisory implements SolandraAdvisoryRuntime {
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    assert.deepEqual(input.knowledge, []);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Water the herbs first.",
        basis: [],
        rationale: ["This best matches your preference to finish the quicker chore first."],
        tradeoffs: [],
        assumptions: [],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Fold the clean laundry first."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

function assertNaturalPresentation(text: string): void {
  assert.doesNotMatch(
    text,
    /proposal wording|advisory judgment|Established support|governed factual support|factual Knowledge/iu,
  );
}

function assertNoExecutionOverclaim(text: string): void {
  assert.doesNotMatch(
    text,
    /\b(?:I'll|I will|I'm going to|I am going to|I went ahead|I've gone ahead|I sent|I executed|I applied)\b/iu,
  );
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-state-presentation-user",
} as NodeJS.ProcessEnv);

test("Issue #91: recommendation and AcceptedChoice presentation never outrun established Product state", async () => {
  const cognition = new StateDrivenCognition();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: cognition,
    solandraAdvisory: new StateDrivenAdvisory(),
  });

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().conversation.id as string;

    const firstUserMessage = "I'm deciding whether to water the herbs or fold clean laundry first. I'd like to finish the quicker chore first. What would you pick?";
    const recommendationTurn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "state-presentation-1",
        message: firstUserMessage,
      },
    });
    assert.equal(recommendationTurn.statusCode, 200, recommendationTurn.body);
    const recommendation = recommendationTurn.json<{
      status: string;
      recommendationReference: {
        recommendationId: string;
        selectionAuthorized: boolean;
        options: Array<{ optionId: string; text: string; recommended: boolean }>;
      };
      presentation: { assistantMessage: string };
      actionProposal?: unknown;
      authorization?: unknown;
      executionReceipt?: unknown;
      verification?: unknown;
    }>();
    assert.equal(recommendation.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(recommendation.recommendationReference.selectionAuthorized, false);
    assert.equal(recommendation.recommendationReference.options[0]?.text, "Water the herbs first.");
    assert.match(recommendation.presentation.assistantMessage, /Water the herbs first\./u);
    assertNaturalPresentation(recommendation.presentation.assistantMessage);
    assertNoExecutionOverclaim(recommendation.presentation.assistantMessage);
    assert.equal(recommendation.actionProposal, undefined);
    assert.equal(recommendation.authorization, undefined);
    assert.equal(recommendation.executionReceipt, undefined);
    assert.equal(recommendation.verification, undefined);
    console.log(`ISSUE91_BLACKBOX_RECOMMENDATION=${JSON.stringify({
      user: firstUserMessage,
      assistant: recommendation.presentation.assistantMessage,
    })}`);

    const secondUserMessage = "That works for me. Make your recommendation my choice.";
    const choiceTurn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "state-presentation-2",
        message: secondUserMessage,
      },
    });
    assert.equal(choiceTurn.statusCode, 200, choiceTurn.body);
    const choice = choiceTurn.json<{
      status: string;
      acceptedChoice: {
        optionId: string;
        optionText: string;
        authorizationGranted: boolean;
        executionAuthorized: boolean;
      };
      presentation: { assistantMessage: string };
      actionProposal?: unknown;
      authorization?: unknown;
      executionReceipt?: unknown;
      verification?: unknown;
    }>();
    assert.equal(choice.status, "ACCEPTED_CHOICE_ESTABLISHED");
    assert.equal(choice.acceptedChoice.optionText, "Water the herbs first.");
    assert.equal(choice.acceptedChoice.authorizationGranted, false);
    assert.equal(choice.acceptedChoice.executionAuthorized, false);
    assert.match(choice.presentation.assistantMessage, /Water the herbs first\./u);
    assertNaturalPresentation(choice.presentation.assistantMessage);
    assertNoExecutionOverclaim(choice.presentation.assistantMessage);
    assert.equal(choice.actionProposal, undefined);
    assert.equal(choice.authorization, undefined);
    assert.equal(choice.executionReceipt, undefined);
    assert.equal(choice.verification, undefined);
    console.log(`ISSUE91_BLACKBOX_CHOICE=${JSON.stringify({
      user: secondUserMessage,
      assistant: choice.presentation.assistantMessage,
    })}`);

    assert.equal(cognition.inputs.length, 2);
    assert.equal(cognition.inputs[1]?.governedRecommendations?.[0]?.selectionAuthorized, false);
  } finally {
    await app.close();
  }
});

class CaptureProvider implements ModelProvider {
  readonly kind = "issue-91-state-presentation-capture";
  request: CanonicalModelRequest | undefined;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.request = structuredClone(request);
    return {
      response: {
        id: "issue-91-state-presentation-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            mode: "GOVERNED",
            response: null,
            projection: proposal({
              requestedHelp: "ACCEPT_CHOICE",
              referencedRecommendationId: "recommendation-state-1",
              referencedOptionId: "option-state-1",
            }),
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "issue-91-state-presentation-response",
      },
    };
  }
}

test("Issue #91: canonical cognition receives exact Recommendation state and the state-faithful presentation rule", async () => {
  const provider = new CaptureProvider();
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-91-state-presentation-model");
  const result = await cognition.interpret({
    conversationId: "conversation-state-presentation",
    messageId: "message-state-presentation",
    message: "I'll take your recommendation as my choice.",
    currentObjective: "Choose between two harmless chores.",
    recentUserMessages: ["Choose between two harmless chores.", "I'll take your recommendation as my choice."],
    governedKnowledge: [],
    governedRecommendations: [{
      recommendationId: "recommendation-state-1",
      recommendation: "Water the herbs first.",
      intentVersionId: "intent-state-1",
      knowledgeIds: [],
      createdAt: "2026-09-14T20:00:00.000Z",
      selectionAuthorized: false,
      options: [{
        optionId: "option-state-1",
        position: 1,
        text: "Water the herbs first.",
        recommended: true,
      }],
    }],
  });
  if (result.mode === "CONVERSATION") assert.fail("expected exact Recommendation choice to use governed state");
  assert.equal(result.mode, "GOVERNED");
  assert.equal(result.proposal.requestedHelp, "ACCEPT_CHOICE");

  const system = provider.request?.messages[0]?.content ?? "";
  const user = provider.request?.messages[1]?.content ?? "";
  assert.match(system, /A Recommendation is not a USER choice; a USER choice is not authorization; authorization is not execution; execution is not verification\./u);
  assert.match(system, /ACCEPT_CHOICE records the USER's choice only; it does not authorize or execute the option\./u);
  assert.match(user, /Selection authorized: false/u);
});

test("Issue #91: PreparedResource remains editable non-execution state in Product presentation", () => {
  const record = buildPreparedResourceRecord({
    conversationId: "conversation-state-resource",
    runId: "91919191-9191-4919-8919-919191919191",
    intentScopeId: "consultation:conversation-state-resource",
    intentVersionId: "intent-state-resource",
    sourceMessageId: "message-state-resource",
    kind: "PREPARED_MESSAGE",
    title: "Prepared note",
    body: "Please confirm which afternoon works best.",
    basis: [],
    preservedUncertainties: [],
    createdAt: "2026-09-14T20:00:00.000Z",
  });
  const resource = preparedResourceFromRecord(record);
  assert.equal(resource.editable, true);
  assert.equal(resource.executionAuthorized, false);

  const page = renderSolandraAuthoritativeConversationPage();
  assert.match(page, /Nothing has been sent or executed\./u);
});
