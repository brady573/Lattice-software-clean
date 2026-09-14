import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildConversationReference,
  MemoryConversationReferenceStore,
  PostgresConversationReferenceStore,
  type ConversationReferenceAuthority,
  type ConversationReferenceRecord,
  type ConversationReferenceStore,
} from "../src/conversation/conversation-reference-store.js";
import {
  MemoryConversationStore,
  PostgresConversationStore,
  type ConversationStore,
} from "../src/conversation/conversation-store.js";

const FIXED_TIME = "2026-09-14T16:00:00.000Z";
const databaseUrl = process.env.DATABASE_URL;

type FixtureIds = ReturnType<typeof fixtureIds>;

function fixtureIds() {
  const suffix = randomUUID();
  return {
    conversationA: `conversation-a-${suffix}`,
    conversationB: `conversation-b-${suffix}`,
    messageA: `message-a-${suffix}`,
    messageB: `message-b-${suffix}`,
    scopeA: `scope-a-${suffix}`,
    scopeB: `scope-b-${suffix}`,
    versionA: `version-a-${suffix}`,
    versionB: `version-b-${suffix}`,
    knowledgeA: `knowledge-a-${suffix}`,
    knowledgeB: `knowledge-b-${suffix}`,
    recommendationA: `recommendation-a-${suffix}`,
    recommendationOther: `recommendation-other-${suffix}`,
    recommendationB: `recommendation-b-${suffix}`,
    optionA: `option-a-${suffix}`,
    optionA2: `option-a-2-${suffix}`,
    optionOther: `option-other-${suffix}`,
    optionB: `option-b-${suffix}`,
    acceptedChoiceA: `accepted-choice-a-${suffix}`,
    acceptedChoiceBadLineage: `accepted-choice-bad-${suffix}`,
    resourceA: `resource-a-${suffix}`,
    resourceB: `resource-b-${suffix}`,
  };
}

function authorityFor(conversationStore: ConversationStore, ids: FixtureIds): ConversationReferenceAuthority {
  const messages = new Map([
    [ids.messageA, { messageId: ids.messageA, conversationId: ids.conversationA, intentScopeId: ids.scopeA }],
    [ids.messageB, { messageId: ids.messageB, conversationId: ids.conversationB, intentScopeId: ids.scopeB }],
  ]);
  const versions = new Map([
    [ids.versionA, { intentVersionId: ids.versionA, intentScopeId: ids.scopeA }],
    [ids.versionB, { intentVersionId: ids.versionB, intentScopeId: ids.scopeB }],
  ]);
  const knowledge = new Map([
    [ids.knowledgeA, { knowledgeId: ids.knowledgeA, conversationId: ids.conversationA }],
    [ids.knowledgeB, { knowledgeId: ids.knowledgeB, conversationId: ids.conversationB }],
  ]);
  const recommendations = new Map([
    [ids.recommendationA, {
      recommendationId: ids.recommendationA,
      conversationId: ids.conversationA,
      proposals: [{ proposalId: ids.optionA }, { proposalId: ids.optionA2 }],
    }],
    [ids.recommendationOther, {
      recommendationId: ids.recommendationOther,
      conversationId: ids.conversationA,
      proposals: [{ proposalId: ids.optionOther }],
    }],
    [ids.recommendationB, {
      recommendationId: ids.recommendationB,
      conversationId: ids.conversationB,
      proposals: [{ proposalId: ids.optionB }],
    }],
  ]);
  const acceptedChoices = new Map([
    [ids.acceptedChoiceA, {
      acceptedChoiceId: ids.acceptedChoiceA,
      conversationId: ids.conversationA,
      recommendationId: ids.recommendationA,
      optionId: ids.optionA,
      authorizationGranted: false as const,
      executionAuthorized: false as const,
    }],
    [ids.acceptedChoiceBadLineage, {
      acceptedChoiceId: ids.acceptedChoiceBadLineage,
      conversationId: ids.conversationA,
      recommendationId: ids.recommendationA,
      optionId: ids.optionOther,
      authorizationGranted: false as const,
      executionAuthorized: false as const,
    }],
  ]);
  const resources = new Map([
    [ids.resourceA, {
      resourceId: ids.resourceA,
      conversationId: ids.conversationA,
      knowledgeIds: [ids.knowledgeA],
      executionAuthorized: false as const,
    }],
    [ids.resourceB, {
      resourceId: ids.resourceB,
      conversationId: ids.conversationB,
      knowledgeIds: [ids.knowledgeB],
      executionAuthorized: false as const,
    }],
  ]);

  return {
    conversationStore,
    userMessageStore: {
      async get(messageId) { return structuredClone(messages.get(messageId)); },
    },
    intentStore: {
      async getVersion(intentVersionId) { return structuredClone(versions.get(intentVersionId)); },
    },
    knowledgeStore: {
      async getKnowledge(knowledgeId) { return structuredClone(knowledge.get(knowledgeId)); },
    },
    recommendationStore: {
      async getRecommendation(recommendationId) {
        return structuredClone(recommendations.get(recommendationId));
      },
      async listRecommendationsByConversation(conversationId) {
        return [...recommendations.values()]
          .filter((record) => record.conversationId === conversationId)
          .map((record) => structuredClone(record));
      },
    },
    acceptedChoiceStore: {
      async getAcceptedChoice(acceptedChoiceId) {
        return structuredClone(acceptedChoices.get(acceptedChoiceId));
      },
    },
    preparedResourceStore: {
      async getPreparedResource(resourceId) {
        return structuredClone(resources.get(resourceId));
      },
    },
  };
}

interface Harness {
  ids: FixtureIds;
  authority: ConversationReferenceAuthority;
  conversationStore: ConversationStore;
  store: ConversationReferenceStore;
  reconnect?: () => Promise<ConversationReferenceStore>;
}

async function memoryHarness(): Promise<Harness> {
  const ids = fixtureIds();
  const conversationStore = new MemoryConversationStore();
  await conversationStore.create(ids.conversationA, `owner-a-${ids.conversationA}`);
  await conversationStore.create(ids.conversationB, `owner-b-${ids.conversationB}`);
  const authority = authorityFor(conversationStore, ids);
  return {
    ids,
    authority,
    conversationStore,
    store: new MemoryConversationReferenceStore(authority),
  };
}

async function postgresHarness(): Promise<Harness> {
  assert.ok(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);
  await PostgresConversationReferenceStore.migrate(databaseUrl);
  const ids = fixtureIds();
  const conversationStore = await PostgresConversationStore.connect(databaseUrl, { migrate: false });
  await conversationStore.create(ids.conversationA, `owner-a-${ids.conversationA}`);
  await conversationStore.create(ids.conversationB, `owner-b-${ids.conversationB}`);
  const authority = authorityFor(conversationStore, ids);
  return {
    ids,
    authority,
    conversationStore,
    store: await PostgresConversationReferenceStore.connect(databaseUrl, authority),
    reconnect: async () => PostgresConversationReferenceStore.connect(databaseUrl, authority),
  };
}

function reference(
  ids: FixtureIds,
  overrides: Partial<Parameters<typeof buildConversationReference>[0]> = {},
): ConversationReferenceRecord {
  return buildConversationReference({
    conversationId: ids.conversationA,
    userMessageId: ids.messageA,
    responseId: `response-${randomUUID()}`,
    intentVersionId: ids.versionA,
    targets: [{ kind: "KNOWLEDGE", targetId: ids.knowledgeA, relation: "CONSUMED" }],
    createdAt: FIXED_TIME,
    ...overrides,
  });
}

async function rejects(store: ConversationReferenceStore, candidate: ConversationReferenceRecord): Promise<void> {
  await assert.rejects(() => store.putReference(candidate));
}

async function runIntegrityMatrix(harness: Harness): Promise<ConversationReferenceRecord> {
  const { store, ids } = harness;

  const validRecommendation = reference(ids, {
    responseId: `recommendation-response-${randomUUID()}`,
    targets: [
      { kind: "RECOMMENDATION", targetId: ids.recommendationA, relation: "PRODUCED" },
      { kind: "OPTION", targetId: ids.optionA, relation: "PRODUCED" },
      { kind: "OPTION", targetId: ids.optionA2, relation: "PRODUCED" },
    ],
  });
  const first = await store.putReference(validRecommendation);
  const replay = await store.putReference(validRecommendation);
  assert.deepEqual(replay, first, "valid duplicate write must be idempotent");

  const validChoice = reference(ids, {
    responseId: `choice-response-${randomUUID()}`,
    targets: [
      { kind: "RECOMMENDATION", targetId: ids.recommendationA, relation: "CONSUMED" },
      { kind: "OPTION", targetId: ids.optionA, relation: "CONSUMED" },
      { kind: "ACCEPTED_CHOICE", targetId: ids.acceptedChoiceA, relation: "PRODUCED" },
    ],
  });
  const exactMultiTarget = await store.putReference(validChoice);
  assert.equal(exactMultiTarget.targets.length, 3);

  const validResource = reference(ids, {
    responseId: `resource-response-${randomUUID()}`,
    targets: [
      { kind: "KNOWLEDGE", targetId: ids.knowledgeA, relation: "CONSUMED" },
      { kind: "PREPARED_RESOURCE", targetId: ids.resourceA, relation: "PRODUCED" },
    ],
  });
  await store.putReference(validResource);

  const parentB = await store.putReference(reference(ids, {
    conversationId: ids.conversationB,
    userMessageId: ids.messageB,
    responseId: `parent-b-${randomUUID()}`,
    intentVersionId: ids.versionB,
    targets: [{ kind: "KNOWLEDGE", targetId: ids.knowledgeB, relation: "CONSUMED" }],
  }));

  await rejects(store, reference(ids, { parentReferenceId: `missing-parent-${randomUUID()}` }));
  await rejects(store, reference(ids, { parentReferenceId: parentB.referenceId }));
  await rejects(store, reference(ids, { userMessageId: ids.messageB }));
  await rejects(store, reference(ids, { intentVersionId: ids.versionB }));
  await rejects(store, reference(ids, {
    targets: [{ kind: "KNOWLEDGE", targetId: `missing-knowledge-${randomUUID()}`, relation: "CONSUMED" }],
  }));
  await rejects(store, reference(ids, {
    targets: [{ kind: "KNOWLEDGE", targetId: ids.knowledgeB, relation: "CONSUMED" }],
  }));
  await rejects(store, reference(ids, {
    targets: [{ kind: "RECOMMENDATION", targetId: `missing-recommendation-${randomUUID()}`, relation: "CONSUMED" }],
  }));
  await rejects(store, reference(ids, {
    targets: [
      { kind: "RECOMMENDATION", targetId: ids.recommendationA, relation: "CONSUMED" },
      { kind: "OPTION", targetId: ids.optionOther, relation: "CONSUMED" },
    ],
  }));
  await rejects(store, reference(ids, {
    targets: [
      { kind: "RECOMMENDATION", targetId: ids.recommendationA, relation: "CONSUMED" },
      { kind: "OPTION", targetId: ids.optionA, relation: "CONSUMED" },
      { kind: "ACCEPTED_CHOICE", targetId: ids.acceptedChoiceBadLineage, relation: "PRODUCED" },
    ],
  }));
  await rejects(store, reference(ids, {
    targets: [{ kind: "PREPARED_RESOURCE", targetId: ids.resourceB, relation: "CONSUMED" }],
  }));

  const choiceBefore = await harness.authority.acceptedChoiceStore.getAcceptedChoice(ids.acceptedChoiceA);
  const resourceBefore = await harness.authority.preparedResourceStore.getPreparedResource(ids.resourceA);
  assert.equal(choiceBefore?.authorizationGranted, false);
  assert.equal(choiceBefore?.executionAuthorized, false);
  assert.equal(resourceBefore?.executionAuthorized, false);

  await store.putReference(reference(ids, {
    responseId: `authority-check-${randomUUID()}`,
    targets: [{ kind: "ACCEPTED_CHOICE", targetId: ids.acceptedChoiceA, relation: "CONSUMED" }],
  }));
  await store.putReference(reference(ids, {
    responseId: `resource-authority-check-${randomUUID()}`,
    targets: [{ kind: "PREPARED_RESOURCE", targetId: ids.resourceA, relation: "CONSUMED" }],
  }));

  assert.deepEqual(await harness.authority.acceptedChoiceStore.getAcceptedChoice(ids.acceptedChoiceA), choiceBefore);
  assert.deepEqual(await harness.authority.preparedResourceStore.getPreparedResource(ids.resourceA), resourceBefore);
  return exactMultiTarget;
}

test("Issue #91: memory ConversationReference admission rejects invalid governed identity and preserves authority separation", async () => {
  const harness = await memoryHarness();
  try {
    await runIntegrityMatrix(harness);
  } finally {
    await harness.store.close();
    await harness.conversationStore.close();
  }
});

test("Issue #91: PostgreSQL ConversationReference admission matches memory integrity and survives reconnect", {
  skip: databaseUrl === undefined ? "DATABASE_URL is required for PostgreSQL ConversationReference integration." : false,
}, async () => {
  const harness = await postgresHarness();
  let store = harness.store;
  try {
    const persisted = await runIntegrityMatrix(harness);
    assert.ok(harness.reconnect);
    await store.close();
    store = await harness.reconnect();
    harness.store = store;

    const reloaded = await store.getReference(persisted.referenceId);
    assert.deepEqual(reloaded, persisted, "exact ConversationReference identity must survive reconnect");

    await rejects(store, reference(harness.ids, {
      userMessageId: harness.ids.messageB,
      responseId: `post-restart-invalid-${randomUUID()}`,
    }));
  } finally {
    await store.close();
    await harness.conversationStore.close();
  }
});
