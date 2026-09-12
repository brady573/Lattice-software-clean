import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraAdvisoryInput,
  SolandraAdvisoryRuntime,
  SolandraAdvisoryRuntimeResult,
} from "../src/solandra/advisory.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-45-option2-held-out",
  requestedModel: "issue-45-option2-held-out-model",
  actualProvider: "issue-45-option2-held-out",
  actualModel: "issue-45-option2-held-out-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-45-option2-held-out",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
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

class EveningTaskCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const recommendation = input.governedRecommendations?.at(-1);
    if (/second suggestion/iu.test(input.message)) {
      return {
        proposal: proposal({
          requestedHelp: "EXPLAIN_OPTION",
          referencedRecommendationId: recommendation?.recommendationId ?? null,
          referencedOptionId: recommendation?.options[1]?.optionId ?? null,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (/use that one/iu.test(input.message)) {
      return {
        proposal: proposal({
          requestedHelp: "ACCEPT_CHOICE",
          referencedRecommendationId: recommendation?.recommendationId ?? null,
          referencedOptionId: recommendation?.options[1]?.optionId ?? null,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        preferences: ["finishing quickly", "keeping the evening flexible"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class EveningTaskAdvisory implements SolandraAdvisoryRuntime {
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    assert.deepEqual(input.knowledge, []);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Start with one task that fits in a short time block.",
        basis: [],
        rationale: ["This is a preference-sensitive judgment over the USER's stated priorities."],
        tradeoffs: ["A larger task can wait for a less constrained evening."],
        assumptions: [],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: [
          "Pick whichever task has been waiting longest.",
          "Rotate through rooms on different evenings.",
        ],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

const EVENING_MESSAGE = "I want an easy way to decide what small household task to do after work; I care about finishing quickly and keeping the rest of the evening flexible.";

test("Issue #45 Option 2 held-out: ordinary goal-only advice keeps Solandra proposal identity separate through follow-up and USER acceptance", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-45-option2-evening-user",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new EveningTaskCognition(),
    solandraAdvisory: new EveningTaskAdvisory(),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json().conversation.id as string;
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "option2-evening-1", message: EVENING_MESSAGE },
    });
    assert.equal(first.statusCode, 200, first.body);
    const firstBody = first.json();
    assert.equal(firstBody.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(firstBody.recommendationReference.options[0].text, "Start with one task that fits in a short time block.");
    assert.ok(!EVENING_MESSAGE.includes(firstBody.recommendationReference.options[0].text));
    assert.equal(firstBody.recommendationReference.selectionAuthorized, false);

    const recommendationId = firstBody.recommendationReference.recommendationId as string;
    const raw = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(raw.statusCode, 200, raw.body);
    const rawBody = raw.json();
    assert.equal(rawBody.representationKind, "STRUCTURAL_PROPOSAL_V2");
    assert.ok(Array.isArray(rawBody.proposals));
    assert.ok(rawBody.proposals.every((item: { origin: string; factualAuthority: boolean }) => item.origin === "SOLANDRA" && item.factualAuthority === false));
    assert.equal(Object.hasOwn(rawBody, "recommendation"), false);
    assert.equal(Object.hasOwn(rawBody, "alternatives"), false);
    assert.deepEqual(rawBody.rationale, []);

    const explain = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "option2-evening-2", message: "Tell me more about the second suggestion." },
    });
    assert.equal(explain.statusCode, 200, explain.body);
    assert.equal(explain.json().status, "OPTION_REFERENCE_RESOLVED");
    const secondOptionId = firstBody.recommendationReference.options[1].optionId as string;
    assert.equal(explain.json().optionReference.optionId, secondOptionId);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "option2-evening-3", message: "Use that one." },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().status, "ACCEPTED_CHOICE_ESTABLISHED");
    assert.equal(accepted.json().acceptedChoice.optionId, secondOptionId);
    assert.equal(accepted.json().acceptedChoice.authorizationGranted, false);
    assert.equal(accepted.json().acceptedChoice.executionAuthorized, false);
  } finally {
    await app.close();
  }
});

const STORAGE_MESSAGE = "Help me choose a way to store my bicycle in a narrow apartment; I care most about keeping the hallway clear.";
const STORAGE_NEED = "documented load guidance for a wall-mounted bicycle storage option";
const STORAGE_FACT = "The wall-mounted rack is rated by its manufacturer for one bicycle up to 50 pounds.";

class BicycleCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        preferences: ["keeping the hallway clear"],
        knowledgeNeeds: [STORAGE_NEED],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class BicycleAcquisition implements KnowledgeAcquisitionProvider {
  readonly kind = "issue-45-option2-bicycle-acquisition";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "issue-45-option2-bicycle-source",
        canonicalUri: "https://held-out.example/bicycle-rack",
        title: "Bicycle rack load reference",
        publisher: "Held-out Fixture",
        retrievedAt: "2026-09-12T20:00:00.000Z",
        publishedAt: null,
        contentType: "text/plain",
        content: STORAGE_FACT,
      }],
      claims: [{
        claimId: "issue-45-option2-bicycle-claim",
        text: STORAGE_FACT,
        claimType: "INTERPRETIVE",
        evidence: [{
          sourceId: "issue-45-option2-bicycle-source",
          relation: "SUPPORTS",
          excerpt: STORAGE_FACT,
        }],
      }],
    };
  }
}

class BicycleAdvisory implements SolandraAdvisoryRuntime {
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const finding = knowledge.findings.find((item) => item.text === STORAGE_FACT);
    assert.ok(finding);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Use the wall-mounted rack if your bicycle fits the documented load limit.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [finding.claimId] }],
        rationale: ["This option better matches the USER's hallway-clearance priority."],
        tradeoffs: ["Wall storage requires a suitable mounting location."],
        assumptions: ["keeping the hallway clear"],
        uncertainties: [...knowledge.uncertainties],
        preservedUncertainties: [...knowledge.uncertainties],
        alternatives: ["Use a compact floor stand in a low-traffic corner."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

async function waitForCompleted(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json().status as string;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Held-out Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Held-out external-Knowledge Run did not complete.");
}

test("Issue #45 Option 2 held-out: goal-only decision can use governed external Knowledge while proposal wording remains separately classified", async () => {
  const acquisition = new BicycleAcquisition();
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
    solandraCognition: new BicycleCognition(),
    solandraAdvisory: new BicycleAdvisory(),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json().conversation.id as string;
    const turn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "option2-bicycle-1", message: STORAGE_MESSAGE },
    });
    assert.equal(turn.statusCode, 202, turn.body);
    assert.equal(turn.json().status, "RUN_ACCEPTED");
    assert.deepEqual(turn.json().interpretation.knowledgeNeeds, [STORAGE_NEED]);
    const runId = turn.json().runId as string;
    await waitForCompleted(app, runId);

    let outcome;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      if (outcome.statusCode !== 202) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(outcome);
    assert.equal(outcome.statusCode, 200, outcome.body);
    const recommendationId = outcome.json().recommendationReference.recommendationId as string;
    assert.equal(outcome.json().recommendationReference.options[0].text, "Use the wall-mounted rack if your bicycle fits the documented load limit.");
    assert.ok(!STORAGE_MESSAGE.includes(outcome.json().recommendationReference.options[0].text));

    const recommendation = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(recommendation.statusCode, 200, recommendation.body);
    const record = recommendation.json();
    assert.equal(record.proposals[0].origin, "SOLANDRA");
    assert.equal(record.proposals[0].factualAuthority, false);
    assert.equal(record.knowledgeIds.length, 1);
    assert.equal(record.claimIds.length, 1);
    assert.equal(record.factualBasis.length, 1);
    assert.equal(record.factualBasis[0].sourceIds.length, 1);
    assert.ok(record.rationale.some((item: string) => item.includes(STORAGE_FACT)));
    assert.equal(acquisition.requests.length, 1);
  } finally {
    await app.close();
  }
});

class MailCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const recommendation = input.governedRecommendations?.at(-1);
    if (/choose the second/iu.test(input.message)) {
      return {
        proposal: proposal({
          requestedHelp: "ACCEPT_CHOICE",
          referencedRecommendationId: recommendation?.recommendationId ?? null,
          referencedOptionId: recommendation?.options[1]?.optionId ?? null,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        preferences: ["least upkeep"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

const mailAdvisory: SolandraAdvisoryRuntime = {
  async advise(input) {
    assert.deepEqual(input.knowledge, []);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Sort mail once into action, file, and recycle piles.",
        basis: [],
        rationale: ["This is advisory judgment over the USER's low-upkeep preference."],
        tradeoffs: [],
        assumptions: [],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Use one inbox and process everything at the end of the week."],
      },
      invocationProvenance: PROVENANCE,
    };
  },
};

const MAIL_MESSAGE = "Help me pick a simple way to sort incoming paper mail; I want the least upkeep.";

test("Issue #45 Option 2 held-out: proposal origin, identity, ranking, and non-authorizing USER acceptance survive PostgreSQL restart", { skip: !DATABASE_URL }, async () => {
  const config = resolveRuntimeConfig({
    DATABASE_URL: DATABASE_URL!,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: "true",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-45-option2-mail-user",
  } as NodeJS.ProcessEnv);
  let first = await createRuntimeApp(config, {
    solandraCognition: new MailCognition(),
    solandraAdvisory: mailAdvisory,
  });
  let conversationId = "";
  let recommendationId = "";
  let optionIds: string[] = [];
  let acceptedChoiceId = "";
  try {
    const created = await first.inject({ method: "POST", url: "/api/v1/conversations" });
    conversationId = created.json().conversation.id as string;
    const recommendation = await first.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "option2-mail-1", message: MAIL_MESSAGE },
    });
    assert.equal(recommendation.statusCode, 200, recommendation.body);
    recommendationId = recommendation.json().recommendationReference.recommendationId as string;
    optionIds = recommendation.json().recommendationReference.options.map((item: { optionId: string }) => item.optionId);

    const raw = await first.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(raw.statusCode, 200, raw.body);
    assert.ok(raw.json().proposals.every((item: { origin: string; factualAuthority: boolean }) => item.origin === "SOLANDRA" && item.factualAuthority === false));

    const accepted = await first.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "option2-mail-2", message: "I choose the second suggestion." },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().acceptedChoice.optionId, optionIds[1]);
    assert.equal(accepted.json().acceptedChoice.authorizationGranted, false);
    assert.equal(accepted.json().acceptedChoice.executionAuthorized, false);
    acceptedChoiceId = accepted.json().acceptedChoice.acceptedChoiceId as string;
  } finally {
    await first.close();
  }

  const restartConfig = resolveRuntimeConfig({
    DATABASE_URL: DATABASE_URL!,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: "false",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-45-option2-mail-user",
  } as NodeJS.ProcessEnv);
  const second = await createRuntimeApp(restartConfig, {
    solandraCognition: new MailCognition(),
    solandraAdvisory: mailAdvisory,
  });
  try {
    const continuity = await second.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const persisted = continuity.json().recommendations[0];
    assert.equal(persisted.recommendationId, recommendationId);
    assert.deepEqual(persisted.options.map((item: { optionId: string }) => item.optionId), optionIds);
    assert.equal(continuity.json().acceptedChoices[0].acceptedChoiceId, acceptedChoiceId);
    assert.equal(continuity.json().acceptedChoices[0].authorizationGranted, false);
    assert.equal(continuity.json().acceptedChoices[0].executionAuthorized, false);

    const raw = await second.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(raw.statusCode, 200, raw.body);
    assert.equal(raw.json().representationKind, "STRUCTURAL_PROPOSAL_V2");
    assert.deepEqual(raw.json().rankedProposalIds, optionIds);
    assert.ok(raw.json().proposals.every((item: { origin: string; factualAuthority: boolean }) => item.origin === "SOLANDRA" && item.factualAuthority === false));
  } finally {
    await second.close();
  }
});
