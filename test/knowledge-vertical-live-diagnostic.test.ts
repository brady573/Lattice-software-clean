import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const QUESTIONS = [
  "Why do leaves change color in autumn?",
  "How does a refrigerator keep food cold?",
  "Why does salt melt ice on roads?",
  "Does drinking exactly 137 milliliters of water every morning guarantee that I will never get a headache?",
] as const;

async function request(app: any, options: any): Promise<any> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}

async function waitForOutcome(app: any, runId: string): Promise<any> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${run.status}.`);
    }
    if (run.status === "COMPLETED") {
      return await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not complete within 45 seconds.`);
}

test("temporary live Knowledge vertical diagnostic", { timeout: 240_000 }, async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  });
  const rawProvider = new WikimediaKnowledgeAcquisitionProvider();
  const acquisitions: Array<{
    objective: string;
    investigationQueries: string[];
    retrieved: Array<{ sourceId: string; title: string; canonicalUri: string }>;
  }> = [];
  const recordingProvider = {
    kind: `diagnostic:${rawProvider.kind}`,
    async acquire(input: Parameters<typeof rawProvider.acquire>[0]) {
      const result = await rawProvider.acquire(input);
      acquisitions.push({
        objective: input.objective,
        investigationQueries: [...(input.investigationQueries ?? [])],
        retrieved: result.sources.map((source) => ({
          sourceId: source.sourceId,
          title: source.title,
          canonicalUri: source.canonicalUri,
        })),
      });
      return result;
    },
  };

  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: recordingProvider,
  });

  try {
    const cases = [];
    for (const question of QUESTIONS) {
      const acquisitionStart = acquisitions.length;
      const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
      const conversationId = created.conversation.id as string;
      const accepted = await request(app, {
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: randomUUID(), message: question },
      });
      assert.equal(accepted.status, "RUN_ACCEPTED");
      assert.equal(accepted.acceptedUnderstanding, question);

      const envelope = await waitForOutcome(app, accepted.runId as string);
      assert.equal(envelope.outcome.kind, "KNOWLEDGE");
      const acquisition = acquisitions.slice(acquisitionStart);
      cases.push({
        question,
        acceptedUnderstanding: accepted.acceptedUnderstanding,
        intentVersionId: accepted.intentVersionId,
        decisionNeed: accepted.decisionNeed,
        acquisition,
        outcome: {
          findings: envelope.outcome.findings,
          uncertainties: envelope.outcome.uncertainties,
          provenance: envelope.outcome.provenance,
          evidence: envelope.outcome.evidence,
        },
        assistantMessage: envelope.presentation?.assistantMessage ?? null,
      });
    }

    console.log(`KNOWLEDGE_VERTICAL_LIVE_DIAGNOSTIC=${JSON.stringify({
      truthMode: config.truthMode,
      cases,
    })}`);
  } finally {
    await app.close();
  }
});
