import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { KnowledgeFinding, KnowledgeOutcome } from "../src/outcome.js";
import { renderKnowledgeResponse } from "../src/presentation/solandra/knowledge-response.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

function finding(overrides: Partial<KnowledgeFinding> = {}): KnowledgeFinding {
  return {
    claimId: "claim-1",
    text: "The governed finding text.",
    status: "SUPPORTED",
    confidence: "HIGH",
    evidenceIds: ["evidence-1"],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
    ...overrides,
  };
}

function knowledge(findings: KnowledgeFinding[], uncertainties: string[] = []): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective: "Explain the objective.",
    acceptedUnderstanding: "Explain the objective.",
    findings,
    uncertainties,
    provenance: [],
    truthAssessmentIds: findings.map((item) => `assessment:${item.claimId}`),
  };
}

async function waitForCompletedRun(app: FastifyInstance, runId: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const run = response.json<{ status: string }>();
    if (run.status === "COMPLETED") return;
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached unexpected terminal status ${run.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms.`);
}

test("SUPPORTED finding is projected as supported governed knowledge", () => {
  assert.equal(
    renderKnowledgeResponse(knowledge([finding()])),
    "Supported: The governed finding text.",
  );
});

test("REFUTED finding preserves refutation", () => {
  assert.equal(
    renderKnowledgeResponse(knowledge([finding({ status: "REFUTED" })])),
    "Refuted: The governed finding text.",
  );
});

test("CONFLICTED finding preserves material conflict", () => {
  assert.equal(
    renderKnowledgeResponse(knowledge([finding({ status: "CONFLICTED" })])),
    "Material conflict remains: The governed finding text.",
  );
});

test("SOURCE_REPORT qualification is preserved for every finding status", () => {
  const cases: Array<{ status: KnowledgeFinding["status"]; prefix: string }> = [
    { status: "SUPPORTED", prefix: "Supported as a source report:" },
    { status: "REFUTED", prefix: "Refuted as a source report:" },
    { status: "CONFLICTED", prefix: "Materially conflicted as a source report:" },
    { status: "UNRESOLVED", prefix: "Unresolved as a source report:" },
  ];

  for (const fixture of cases) {
    const response = renderKnowledgeResponse(knowledge([
      finding({ status: fixture.status, basis: "SOURCE_REPORT" }),
    ]));
    assert.match(response, new RegExp(`^${fixture.prefix} The governed finding text\\.`, "u"));
    assert.match(response, /concerns what the retrieved source material reports/u);
    assert.match(response, /does not independently verify the broader real-world claim/u);
  }
});

test("ordinary UNRESOLVED finding does not overstate qualified evidence", () => {
  assert.equal(
    renderKnowledgeResponse(knowledge([finding({ status: "UNRESOLVED", basis: "CLAIM" })])),
    "Qualified evidence did not establish this strongly enough: The governed finding text.",
  );
});

test("empty findings preserve sparse governed uncertainty", () => {
  const uncertainty = "No validated external findings are sufficiently relevant to this objective.";
  assert.equal(renderKnowledgeResponse(knowledge([], [uncertainty])), uncertainty);
});

test("multiple findings remain concise and preserve each governed disposition", () => {
  const response = renderKnowledgeResponse(knowledge([
    finding({ claimId: "supported", text: "Supported material.", status: "SUPPORTED" }),
    finding({ claimId: "refuted", text: "Refuted material.", status: "REFUTED" }),
    finding({ claimId: "conflicted", text: "Conflicted material.", status: "CONFLICTED" }),
  ]));
  assert.equal(
    response,
    [
      "Supported: Supported material.",
      "Refuted: Refuted material.",
      "Material conflict remains: Conflicted material.",
    ].join("\n\n"),
  );
});

test("completed canonical Knowledge response adds downstream assistantMessage without Decision contamination", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 5 });

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const userText = "Explain a trustworthy property of ocean tides.";
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "knowledge-response-envelope", message: userText },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const runId = accepted.json<{ runId: string }>().runId;
    await waitForCompletedRun(app, runId);

    const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(runResponse.statusCode, 200, runResponse.body);
    const run = runResponse.json<{ events: Array<{ type: string }>; decision: unknown }>();
    assert.equal(run.decision, null);
    assert.equal(run.events.some((event) => event.type === "DECIDING"), false);

    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      outcome: KnowledgeOutcome;
      presentation: { assistantMessage: string };
    }>();
    assert.equal(body.outcome.kind, "KNOWLEDGE");
    assert.equal("decision" in body.outcome, false);
    assert.ok(body.presentation.assistantMessage.length > 0);
    assert.match(body.presentation.assistantMessage, /No validated external findings/u);
    assert.doesNotMatch(body.presentation.assistantMessage, /I found \d+ supported source report/u);
  } finally {
    await app.close();
  }
});

test("canonical Solandra browser consumes returned assistantMessage and retains Composer rendering", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /renderKnowledge\(outcome\)/u);
  assert.match(html, /presentation\?\.assistantMessage/u);
  assert.match(html, /appendSolandraTurn\(assistantMessage\)/u);
  assert.match(html, /renderOutcome\(body\.outcome, body\.presentation\)/u);
  assert.doesNotMatch(html, /I found .*supported source report/u);
  assert.doesNotMatch(html, /I couldn’t establish supported knowledge from the available sources/u);
});
