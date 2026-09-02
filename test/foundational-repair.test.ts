import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import type { FixtureDataset } from "../src/fixtures.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type { ProofCheckStatus } from "../src/truth/types.js";

function passedChecks(): Readonly<Record<string, ProofCheckStatus>> {
  return Object.fromEntries(
    requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"] as const),
  );
}

function knowledgeDataset(claimText: string, sourceLabel: string): FixtureDataset {
  return {
    candidates: [],
    evidence: [{
      id: "e-fact",
      candidateId: "knowledge-only",
      criterion: "statement",
      value: claimText,
      sourceId: "source-primary",
      sourceLabel,
      admitted: true,
    }],
    truthClaims: [{
      id: "claim-fact",
      text: claimText,
      claimType: "FACTUAL",
      evidenceIds: ["e-fact"],
      scope: "consultation",
      checks: passedChecks(),
      materiallyMisleading: false,
    }],
    truthEvidence: [{
      evidenceId: "e-fact",
      claimId: "claim-fact",
      provenanceComponentKey: "source-primary",
      provenanceConfidence: "HIGH",
      relation: "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED",
    }],
  };
}

async function waitForCompletedRun(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Run ${runId} unexpectedly reached ${status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

test("three unrelated knowledge scenarios use the same primary API and V36 architecture", async () => {
  const scenarios = [
    {
      message: "What should I know about preserving sourdough starter during a short trip?",
      claim: "A refrigerated sourdough starter can be maintained without daily room-temperature feeding during a short trip.",
      source: "Fermentation reference fixture",
    },
    {
      message: "Explain one reliable property of a lunar eclipse.",
      claim: "A lunar eclipse occurs when Earth passes between the Sun and the Moon and Earth's shadow falls on the Moon.",
      source: "Astronomy reference fixture",
    },
    {
      message: "What is one useful fact about version-control recovery?",
      claim: "A commit creates a durable repository state that can be referenced later while its objects remain reachable.",
      source: "Version-control reference fixture",
    },
  ] as const;

  for (const [index, scenario] of scenarios.entries()) {
    const app = await createRuntimeApp(config, {
      memoryDispatchDelayMs: 1,
      truthPipeline: new OfflineFixtureTruthPipeline(knowledgeDataset(scenario.claim, scenario.source)),
    });
    try {
      const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
      assert.equal(created.statusCode, 201, created.body);
      const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
      const accepted = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: `scenario-${index}`, message: scenario.message },
      });
      assert.equal(accepted.statusCode, 202, accepted.body);
      const runId = accepted.json<{ runId: string }>().runId;
      await waitForCompletedRun(app, runId);

      const run = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
      const runBody = run.json<{ events: Array<{ type: string }>; decision: unknown }>();
      assert.equal(runBody.events.some((event) => event.type === "DECIDING"), false);
      assert.equal(runBody.decision, null);

      const result = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(result.statusCode, 200, result.body);
      const outcome = result.json().outcome;
      assert.equal(outcome.kind, "KNOWLEDGE");
      assert.equal(outcome.acceptedUnderstanding, scenario.message);
      assert.equal(outcome.findings.length, 1);
      assert.equal(outcome.findings[0].status, "SUPPORTED");
      assert.equal(outcome.findings[0].text, scenario.claim);
      assert.equal(outcome.provenance.length, 1);
    } finally {
      await app.close();
    }
  }
});

test("primary consultation sources reject the legacy example vocabulary", async () => {
  const primaryFiles = [
    "src/runtime-app.ts",
    "src/http-app.ts",
    "src/domain.ts",
    "src/consultation-intake.ts",
    "src/outcome.ts",
    "src/run-execution.ts",
    "src/run-store.ts",
    "src/truth/types.ts",
    "src/ui/solandra-authoritative-conversation-page.ts",
    "src/ui/solandra-conversation-page.ts",
  ];
  const forbidden = [
    "Atlas Pro",
    "Nova Air",
    "Forge 15",
    "batteryHours",
    "price.max.usd",
    "performance.relativeToBattery",
  ];

  for (const path of primaryFiles) {
    const source = await readFile(path, "utf8");
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${path} must not contain legacy example token ${token}`);
    }
  }
});

test("canonical runtime does not register bounded decision or historical default routes", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
  try {
    for (const url of [
      "/api/v1/prototype/consultations/default",
      "/api/v1/conversations/00000000-0000-0000-0000-000000000001/intent-scopes/example/clear-user-messages",
      "/api/v1/conversations/00000000-0000-0000-0000-000000000001/intent-scopes/example/messages",
      "/api/v1/conversations/00000000-0000-0000-0000-000000000001/intent-scopes/example/corrections",
    ]) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      assert.notEqual(response.statusCode, 202, `${url} must not be canonical`);
    }
  } finally {
    await app.close();
  }
});

test("authoritative Solandra no longer aliases the historical prototype renderer", async () => {
  const source = await readFile("src/ui/solandra-authoritative-conversation-page.ts", "utf8");
  assert.match(source, /renderSolandraConversationPage/);
  assert.doesNotMatch(source, /solandra-prototype-page/);
});
