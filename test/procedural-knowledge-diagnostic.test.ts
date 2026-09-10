import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import {
  DeterministicKnowledgeInvestigationQueryDeriver,
  ObjectiveKnowledgeRelevanceQualifier,
} from "../src/knowledge/investigation.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const CASES = [
  "I need to know how to prepare my soil for sod.",
  "I need to know how to season a cast iron skillet.",
] as const;

const STOP = new Set([
  "about", "after", "again", "also", "and", "are", "before", "being", "can", "could", "does", "from",
  "have", "how", "into", "its", "know", "need", "that", "the", "their", "then", "there", "these", "they",
  "this", "through", "what", "when", "where", "which", "who", "why", "with", "would", "your",
]);

function tokens(value: string): string[] {
  return [...new Set(value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length >= 3 && !STOP.has(token)) ?? [])];
}

async function boundedFullExtract(pageId: number): Promise<string> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query", pageids: String(pageId), prop: "extracts", explaintext: "1", format: "json", formatversion: "2", origin: "*",
  })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "Lattice-Procedural-Diagnostic/0.1" } });
  if (!response.ok) return "";
  const body = await response.json() as any;
  return typeof body?.query?.pages?.[0]?.extract === "string" ? body.query.pages[0].extract.slice(0, 24000) : "";
}

function responsiveParagraphs(content: string, objective: string): string[] {
  const objectiveTerms = tokens(objective);
  return content.split(/\n\s*\n/u)
    .map((part) => part.trim().replace(/\s+/gu, " "))
    .filter(Boolean)
    .map((text) => ({ text, matches: objectiveTerms.filter((term) => tokens(text).some((candidate) => candidate === term || candidate.startsWith(term) || term.startsWith(candidate))) }))
    .filter((item) => item.matches.length >= 2)
    .slice(0, 4)
    .map((item) => item.text.slice(0, 700));
}

async function request(app: FastifyInstance, options: InjectOptions): Promise<any> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}

async function waitForOutcome(app: FastifyInstance, runId: string): Promise<any> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") return { terminal: run.status };
    if (run.status === "COMPLETED") return request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { terminal: "TIMEOUT" };
}

test("diagnose procedural Knowledge connection", { timeout: 180_000 }, async () => {
  const queryDeriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const relevance = new ObjectiveKnowledgeRelevanceQualifier();
  const rawProvider = new WikimediaKnowledgeAcquisitionProvider();
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-live" });
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, knowledgeAcquisitionProvider: rawProvider });
  const report: any[] = [];
  try {
    for (const objective of CASES) {
      const queries = [...queryDeriver.derive({ objective, context: [] })];
      let raw: Awaited<ReturnType<typeof rawProvider.acquire>> | undefined;
      let rawError: string | null = null;
      try {
        raw = await rawProvider.acquire({ runId: randomUUID(), objective, context: [], investigationQueries: queries });
      } catch (error) {
        rawError = error instanceof Error ? error.message : String(error);
      }

      const sourceById = new Map(raw?.sources.map((source) => [source.sourceId, source]) ?? []);
      const relevanceDecisions = (raw?.claims ?? []).map((claim) => {
        const source = sourceById.get(claim.evidence[0]?.sourceId ?? "");
        if (!source) return { claim: claim.text.slice(0, 500), relevant: false, rationale: "missing source" };
        const disposition = relevance.disposition({ objective, context: [], queries, source, claim });
        return { title: source.title, claim: claim.text.slice(0, 500), ...disposition };
      });

      const fullPageChecks = [];
      for (const source of (raw?.sources ?? []).slice(0, 4)) {
        const pageId = typeof source.metadata?.pageId === "number" ? source.metadata.pageId : null;
        if (pageId === null) continue;
        const full = await boundedFullExtract(pageId);
        fullPageChecks.push({
          title: source.title,
          canonicalUri: source.canonicalUri,
          introClaim: raw?.claims.find((claim) => claim.evidence.some((evidence) => evidence.sourceId === source.sourceId))?.text.slice(0, 700) ?? null,
          responsiveNonIntro: responsiveParagraphs(full, objective),
        });
      }

      const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
      const conversationId = created.conversation.id as string;
      const accepted = await request(app, {
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: randomUUID(), message: objective },
      });
      const envelope = accepted.status === "RUN_ACCEPTED" ? await waitForOutcome(app, accepted.runId as string) : null;

      report.push({
        userMessage: objective,
        acceptedUnderstanding: accepted.acceptedUnderstanding ?? null,
        cognition: accepted.interpretation ?? null,
        derivedQueries: queries,
        acquisitionStrategy: "canonical Wikimedia adapter; full-page only when EXPLANATORY_OBJECTIVE_PATTERN matches",
        rawError,
        rawSources: (raw?.sources ?? []).map((source) => ({ title: source.title, canonicalUri: source.canonicalUri, pageId: source.metadata?.pageId ?? null })),
        rawClaims: (raw?.claims ?? []).map((claim) => claim.text.slice(0, 700)),
        relevanceDecisions,
        fullPageChecks,
        outcome: envelope?.outcome ?? envelope,
        visibleResponse: envelope?.presentation?.assistantMessage ?? null,
      });
    }
    console.log(`PROCEDURAL_KNOWLEDGE_DIAGNOSTIC=${JSON.stringify({ base: "6f6719c9555bce13d8b1ff5110cf07d7a2d7103a", cases: report })}`);
  } finally {
    await app.close();
  }
});
