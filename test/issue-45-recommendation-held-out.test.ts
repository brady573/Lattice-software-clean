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

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-45-held-out",
  requestedModel: "issue-45-held-out-model",
  actualProvider: "issue-45-held-out",
  actualModel: "issue-45-held-out-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-45-held-out",
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

class WeeknightCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        preferences: ["minimal cleanup", "no rigid schedule"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class WeeknightAdvisory implements SolandraAdvisoryRuntime {
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    assert.deepEqual(input.knowledge, []);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Use a flexible two-meal rotation with one fallback night.",
        basis: [],
        rationale: ["I favor a lightweight routine given the USER's stated priorities."],
        tradeoffs: ["The plan is intentionally less rigid."],
        assumptions: ["minimal cleanup", "no rigid schedule"],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Pick meals ad hoc each evening.", "Use a fixed seven-day menu."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

const USER_ONLY_MESSAGE = "I need a simple way to decide what to cook on weeknights; I care about minimal cleanup and no rigid schedule.";

test("Issue #45 held-out: goal/preferences-only decision receives a Solandra-originated advisory proposal", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-45-held-out-user-only",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new WeeknightCognition(),
    solandraAdvisory: new WeeknightAdvisory(),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json().conversation.id as string;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "issue-45-held-out-user-only", message: USER_ONLY_MESSAGE },
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(body.interpretation.requestedHelp, "DECISION");
    assert.equal(body.recommendationReference.options[0].text, "Use a flexible two-meal rotation with one fallback night.");
    assert.ok(!USER_ONLY_MESSAGE.includes(body.recommendationReference.options[0].text));
    assert.equal(body.recommendationReference.selectionAuthorized, false);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json().runs.length, 0);
    assert.deepEqual(continuity.json().recommendations[0].knowledgeIds, []);
  } finally {
    await app.close();
  }
});

const EXTERNAL_MESSAGE = "Help me choose a backup approach for a small website; I care most about fast recovery after an outage.";
const EXTERNAL_NEED = "documented recovery characteristics of practical backup approaches";
const EXTERNAL_FACT = "A snapshot backup can restore a captured point-in-time copy of the website data.";

class BackupCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        preferences: ["fast recovery after an outage"],
        knowledgeNeeds: [EXTERNAL_NEED],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class BackupAcquisition implements KnowledgeAcquisitionProvider {
  readonly kind = "issue-45-held-out-backup-acquisition";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "issue-45-held-out-backup-source",
        canonicalUri: "https://held-out.example/backup-restore",
        title: "Held-out backup restore reference",
        publisher: "Held-out Fixture",
        retrievedAt: "2026-09-12T17:00:00.000Z",
        publishedAt: null,
        contentType: "text/plain",
        content: EXTERNAL_FACT,
      }],
      claims: [{
        claimId: "issue-45-held-out-backup-claim",
        text: EXTERNAL_FACT,
        claimType: "INTERPRETIVE",
        evidence: [{
          sourceId: "issue-45-held-out-backup-source",
          relation: "SUPPORTS",
          excerpt: EXTERNAL_FACT,
        }],
      }],
    };
  }
}

class BackupAdvisory implements SolandraAdvisoryRuntime {
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const finding = knowledge.findings.find((item) => item.text === EXTERNAL_FACT);
    assert.ok(finding);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Use a snapshot-based backup plan with regular restore checks.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [finding.claimId] }],
        rationale: ["I favor the snapshot-based plan given the USER's recovery priority."],
        tradeoffs: ["The recommendation is preference-sensitive."],
        assumptions: ["fast recovery after an outage"],
        uncertainties: [...knowledge.uncertainties],
        preservedUncertainties: [...knowledge.uncertainties],
        alternatives: ["Use a simpler periodic export process."],
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

test("Issue #45 held-out: goal-only decision can use governed external Knowledge without user-authored options", async () => {
  const acquisition = new BackupAcquisition();
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
    solandraCognition: new BackupCognition(),
    solandraAdvisory: new BackupAdvisory(),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json().conversation.id as string;
    const turn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "issue-45-held-out-external", message: EXTERNAL_MESSAGE },
    });
    assert.equal(turn.statusCode, 202, turn.body);
    const accepted = turn.json();
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.deepEqual(accepted.interpretation.knowledgeNeeds, [EXTERNAL_NEED]);
    await waitForCompleted(app, accepted.runId);

    let outcome;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
      if (outcome.statusCode !== 202) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(outcome);
    assert.equal(outcome.statusCode, 200, outcome.body);
    const recommendationId = outcome.json().recommendationReference.recommendationId as string;
    assert.equal(outcome.json().recommendationReference.options[0].text, "Use a snapshot-based backup plan with regular restore checks.");
    assert.ok(!EXTERNAL_MESSAGE.includes(outcome.json().recommendationReference.options[0].text));

    const recommendation = await app.inject({ method: "GET", url: `/api/v1/recommendations/${recommendationId}` });
    assert.equal(recommendation.statusCode, 200, recommendation.body);
    const record = recommendation.json();
    assert.equal(record.proposals[0].text, "Use a snapshot-based backup plan with regular restore checks.");
    assert.equal(record.proposals[0].origin, "SOLANDRA");
    assert.equal(record.proposals[0].factualAuthority, false);
    assert.equal(record.selectionAuthorized, false);
    assert.equal(record.knowledgeIds.length, 1);
    assert.equal(record.claimIds.length, 1);
    assert.equal(record.factualBasis.length, 1);
    assert.equal(record.factualBasis[0].sourceIds.length, 1);
    assert.ok(record.rationale.some((item: string) => item.includes(EXTERNAL_FACT)));
    assert.ok(record.uncertainties.every((item: string) => typeof item === "string" && item.length > 0));
    assert.equal(acquisition.requests.length, 1);
  } finally {
    await app.close();
  }
});
