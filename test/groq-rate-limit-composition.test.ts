import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createConfiguredCapabilityBroker,
} from "../src/capabilities/composition.js";
import {
  USER_AUTHORIZED_MODEL_CAPABILITY_ID,
} from "../src/capabilities/user-model-capability.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
} from "../src/model/groq-knowledge-simplifier.js";
import {
  groqRateLimitScopeId,
  type GroqRateLimitCoordinator,
} from "../src/model/groq-rate-limit-coordinator.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../src/solandra/cognition-composition.js";
import { createConfiguredSolandraKnowledgeInvestigator } from "../src/solandra/knowledge-investigator.js";

const API_KEY = "gsk_composition_scope_fixture_1234567890";

class RecordingCoordinator implements GroqRateLimitCoordinator {
  readonly kind = "memory" as const;
  readonly waits: string[] = [];
  async blockedUntil(): Promise<number> { return 0; }
  async extendBlockedUntil(_scopeId: string, blockedUntilMs: number): Promise<number> { return blockedUntilMs; }
  async waitUntilReady(scopeId: string): Promise<void> { this.waits.push(scopeId); }
  async close(): Promise<void> {}
}

function responseFor(body: string): Response {
  const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
  const system = parsed.messages?.[0]?.content ?? "";
  let content: string;
  if (system.includes("Knowledge investigation cognition")) {
    content = JSON.stringify({ retrievalQueries: ["controlled composition query"] });
  } else if (system.includes("user-authorized cognitive capability")) {
    content = "Bounded capability output.";
  } else {
    content = JSON.stringify({ mode: "CONVERSATION", response: "Bounded conversation output." });
  }
  return new Response(JSON.stringify({
    id: "composition-groq-response",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{ message: { content }, finish_reason: "stop" }],
  }), { status: 200 });
}

test("canonical API-side and Knowledge-investigator compositions derive the same Groq credential/model recovery scope", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: API_KEY,
  } as NodeJS.ProcessEnv);
  const coordinator = new RecordingCoordinator();
  const expectedScope = groqRateLimitScopeId(API_KEY, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    responseFor(String(init?.body ?? "{}"))) as typeof fetch;

  let broker: Awaited<ReturnType<typeof createConfiguredCapabilityBroker>> | undefined;
  try {
    const apiComposition = createConfiguredSolandraCognition(config, coordinator);
    assert.ok(apiComposition);
    await apiComposition.cognition.interpret({
      conversationId: "composition-conversation",
      messageId: "composition-message",
      message: "Suggest a neutral label for my scratch notes.",
      recentUserMessages: [],
      recentConversation: [],
      governedKnowledge: [],
      governedRecommendations: [],
    });

    const workerInvestigator = createConfiguredSolandraKnowledgeInvestigator(config, coordinator);
    assert.ok(workerInvestigator);
    await workerInvestigator.plan({
      runId: "composition-run",
      objective: "Explain the observable mechanism.",
      context: [],
      knowledgeNeeds: ["Find relevant explanatory material."],
    });

    broker = await createConfiguredCapabilityBroker(config, coordinator);
    await broker.broker.connect("composition-subject", USER_AUTHORIZED_MODEL_CAPABILITY_ID);
    await broker.broker.invoke({
      subjectId: "composition-subject",
      capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
      requestId: "composition-capability-request",
      purpose: "ordinary-conversation-cognitive-assistance",
      payload: {
        purpose: "GENERAL_COGNITIVE_ASSISTANCE",
        instruction: "Offer one label.",
        userContext: ["My own scratch notes."],
        governedKnowledge: [],
      },
    });

    assert.equal(coordinator.waits.length, 3);
    assert.deepEqual(new Set(coordinator.waits), new Set([expectedScope]));
  } finally {
    globalThis.fetch = originalFetch;
    await broker?.broker.close();
  }
});

test("canonical API and Run-worker entrypoints independently construct shared durable Groq coordination", async () => {
  const apiSource = await readFile("src/index.ts", "utf8");
  const workerSource = await readFile("src/decision/alpha-decision-run-worker.ts", "utf8");

  assert.match(apiSource, /createGroqRateLimitCoordinator\(config\.databaseUrl\)/u);
  assert.match(apiSource, /requireConfiguredSolandraCognition\(config, groqRateLimitCoordinator\)/u);
  assert.match(apiSource, /createConfiguredCapabilityBroker\(config, groqRateLimitCoordinator\)/u);
  assert.match(apiSource, /createConfiguredTruthPipeline\([\s\S]*groqRateLimitCoordinator/u);

  assert.match(workerSource, /createGroqRateLimitCoordinator\(config\.databaseUrl\)/u);
  assert.match(workerSource, /createConfiguredTruthPipeline\([\s\S]*groqRateLimitCoordinator/u);
  assert.doesNotMatch(workerSource, /sharedMemoryGroqRateLimitCoordinator/u);
});

test("the user-authorized model capability observes the shared gate but retains one logical provider attempt", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: API_KEY,
  } as NodeJS.ProcessEnv);
  const coordinator = new RecordingCoordinator();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ error: { message: "controlled 429" } }), { status: 429 });
  }) as typeof fetch;

  const composition = await createConfiguredCapabilityBroker(config, coordinator);
  try {
    await composition.broker.connect("one-attempt-subject", USER_AUTHORIZED_MODEL_CAPABILITY_ID);
    await assert.rejects(composition.broker.invoke({
      subjectId: "one-attempt-subject",
      capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
      requestId: "one-attempt-request",
      purpose: "ordinary-conversation-cognitive-assistance",
      payload: {
        purpose: "GENERAL_COGNITIVE_ASSISTANCE",
        instruction: "Offer one label.",
        userContext: [],
        governedKnowledge: [],
      },
    }));
    assert.equal(fetches, 1);
    assert.equal(coordinator.waits.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await composition.broker.close();
  }
});
