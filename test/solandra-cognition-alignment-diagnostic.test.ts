import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../src/solandra/cognition-composition.js";

const CANDIDATE = "192f3c27250062d92af01b14944d9ad8697e759b";
const CASES = [
  { id: "A1", pair: "soil", message: "I need to know how to prepare my soil for sod." },
  { id: "A2", pair: "soil", message: "How do I prepare my soil for sod?" },
  { id: "B1", pair: "cookware", message: "I need to know how to season a cast iron skillet." },
  { id: "B2", pair: "cookware", message: "How do I season a cast iron skillet?" },
] as const;

const TILLAGE_TEXT = [
  "Tillage is the agricultural preparation of soil by mechanical agitation of various types, such as digging, stirring, and overturning.",
  "Examples of human-powered tilling methods using hand tools include shoveling, picking, mattock work, hoeing, and raking.",
  "Primary tillage such as ploughing tends to produce a rough surface finish, whereas secondary tillage tends to produce a smoother surface finish, such as that required to make a good seedbed for many crops.",
].join(" ");

class RecordingEvidenceProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "cognition-alignment-preserved-evidence";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    if (!/soil|sod/iu.test(request.objective)) return { sources: [], claims: [] };
    return {
      sources: [{
        sourceId: "page:46191",
        canonicalUri: "https://en.wikipedia.org/wiki/Tillage",
        title: "Tillage",
        publisher: "Wikipedia contributors",
        retrievedAt: "2026-09-10T17:19:32.856Z",
        publishedAt: "2026-09-09T14:12:39.000Z",
        contentType: "text/plain; charset=utf-8",
        content: TILLAGE_TEXT,
        metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
      }],
      claims: [{
        claimId: "source-report:46191",
        text: TILLAGE_TEXT,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "page:46191", relation: "SUPPORTS", excerpt: TILLAGE_TEXT }],
      }],
    };
  }
}

async function request(app: FastifyInstance, options: InjectOptions): Promise<Record<string, any>> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json<Record<string, any>>();
}

async function waitForOutcome(app: FastifyInstance, runId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${String(run.status)}.`);
    if (run.status === "COMPLETED") return request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Run ${runId} did not complete within 30 seconds.`);
}

test("diagnostic: frozen candidate routes semantic paraphrases through configured Solandra cognition rather than lexical fallback", { timeout: 180_000 }, async () => {
  const apiKey = process.env.GROQ_API_KEY;
  assert.ok(apiKey && apiKey.trim().length >= 16, "GROQ_API_KEY is required for configured-cognition evidence.");
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: apiKey,
  });
  const composition = createConfiguredSolandraCognition(config);
  assert.ok(composition, "Configured Solandra cognition must be available.");
  const provider = new RecordingEvidenceProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
    solandraCognition: composition.cognition,
    solandraAdvisory: composition.advisory,
    solandraActionPreparer: composition.actionPreparer,
    solandraKnowledgePresenter: composition.knowledgePresenter,
  });

  try {
    for (const item of CASES) {
      const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
      const conversationId = created.conversation.id as string;
      const before = provider.requests.length;
      const accepted = await request(app, {
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: randomUUID(), message: item.message },
      });
      assert.equal(accepted.status, "RUN_ACCEPTED", JSON.stringify(accepted));
      const outcomeEnvelope = await waitForOutcome(app, accepted.runId as string);
      const calls = provider.requests.slice(before);
      const knowledgeNeeds = (accepted.interpretation?.knowledgeNeeds ?? []) as string[];
      const actualQueries = calls.flatMap((call) => call.investigationQueries ?? []);
      const trace = {
        candidate: CANDIDATE,
        id: item.id,
        pair: item.pair,
        userMessage: item.message,
        cognition: {
          authority: accepted.interpretation?.authority ?? null,
          objectiveRelation: accepted.interpretation?.objectiveRelation ?? null,
          proposedObjective: accepted.interpretation?.proposedObjective ?? null,
          requestedHelp: accepted.interpretation?.requestedHelp ?? null,
          entities: accepted.interpretation?.entities ?? [],
          knowledgeNeeds,
        },
        canonicalIntent: {
          acceptedUnderstanding: accepted.acceptedUnderstanding ?? null,
          intentVersionId: accepted.intentVersionId ?? null,
        },
        acquisitionQueries: actualQueries,
        fallbackQueryDerivationUsed: knowledgeNeeds.length === 0 && actualQueries.length > 0,
        knowledge: {
          kind: outcomeEnvelope.outcome?.kind ?? null,
          findings: outcomeEnvelope.outcome?.findings ?? [],
          provenance: outcomeEnvelope.outcome?.provenance ?? [],
          uncertainties: outcomeEnvelope.outcome?.uncertainties ?? [],
        },
        visibleSolandraResponse: outcomeEnvelope.presentation?.assistantMessage ?? null,
      };
      console.log(`SOLANDRA_COGNITION_ALIGNMENT_POST_REPAIR=${JSON.stringify(trace)}`);

      assert.equal(accepted.acceptedUnderstanding, item.message);
      assert.equal(accepted.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
      assert.equal(accepted.interpretation?.requestedHelp, "KNOWLEDGE");
      assert.ok(knowledgeNeeds.length > 0, `${item.id} must carry task-bearing Solandra knowledgeNeeds.`);
      assert.ok(actualQueries.length > 0, `${item.id} must pass Solandra investigation semantics into acquisition.`);
      assert.deepEqual(actualQueries, knowledgeNeeds.slice(0, 2), `${item.id} acquisition must consume Solandra knowledgeNeeds directly.`);
      assert.equal(trace.fallbackQueryDerivationUsed, false);

      if (item.pair === "soil") {
        assert.equal(outcomeEnvelope.outcome?.kind, "KNOWLEDGE");
        assert.ok((outcomeEnvelope.outcome?.findings ?? []).length > 0, `${item.id} should retain governed Tillage Knowledge.`);
        assert.match(String(outcomeEnvelope.presentation?.assistantMessage ?? ""), /preparation of soil|digging|stirring|overturning|shoveling|hoeing|raking/iu);
        assert.match(String(outcomeEnvelope.presentation?.assistantMessage ?? ""), /does not by itself independently verify the broader real-world claim/iu);
      }
    }
  } finally {
    await app.close();
  }
});
