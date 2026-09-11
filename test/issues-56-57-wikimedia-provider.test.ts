import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRunRequest } from "../src/domain.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const fixedTime = "2026-09-11T12:00:00.000Z";

function searchResponse(): Response {
  return new Response(JSON.stringify({
    query: {
      pages: [{
        pageid: 42,
        index: 1,
        title: "Retrieved topic",
        fullurl: "https://en.wikipedia.org/wiki/Retrieved_topic",
        touched: "2026-09-11T11:59:59.000Z",
        extract: "Introductory source report.",
      }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function fullExtractResponse(): Response {
  return new Response(JSON.stringify({
    query: {
      pages: [{
        pageid: 42,
        title: "Retrieved topic",
        extract: "Full source report with additional detail.",
      }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function successfulResponse(input: RequestInfo | URL): Response {
  const url = new URL(String(input));
  return url.searchParams.has("pageids") ? fullExtractResponse() : searchResponse();
}

function request(runId: string) {
  return {
    runId,
    objective: "Explain the retrieved topic.",
    context: [],
    investigationQueries: ["retrieved topic"],
  } as const;
}

function consultationRequest(): LatticeRunRequest {
  return {
    kind: "consultation",
    objective: "Explain the retrieved topic.",
    context: [],
    investigationQueries: ["retrieved topic"],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "message-wikimedia-provenance",
    sourceMessageDigest: "5".repeat(64),
    intentVersion: 1,
    intentScopeId: "scope-wikimedia-provenance",
    intentVersionId: "intent-wikimedia-provenance",
  };
}

function stallUntilAbort(signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const rejectForAbort = () => reject(signal.reason ?? new Error("aborted"));
    if (signal.aborted) {
      rejectForAbort();
      return;
    }
    signal.addEventListener("abort", rejectForAbort, { once: true });
  });
}

test("Issue #56: Wikimedia page.touched is not represented as publication time", async () => {
  const observedSignals: AbortSignal[] = [];
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    clock: () => new Date(fixedTime),
    fetchImpl: async (input, init) => {
      assert.ok(init?.signal instanceof AbortSignal);
      observedSignals.push(init.signal);
      return successfulResponse(input);
    },
  });

  const result = await provider.acquire(request("issue-56-direct"));
  const source = result.sources[0];
  assert.ok(source);
  assert.equal(Object.hasOwn(source, "publishedAt"), true);
  assert.equal(source.publishedAt, null);
  assert.equal(source.retrievedAt, fixedTime);
  assert.equal(source.sourceId, "page:42");
  assert.equal(source.canonicalUri, "https://en.wikipedia.org/wiki/Retrieved_topic");
  assert.equal(source.title, "Retrieved topic");
  assert.equal(source.publisher, "Wikipedia contributors");
  assert.equal(source.content, "Full source report with additional detail.");
  assert.deepEqual(source.metadata, {
    pageId: 42,
    sourceAdapter: "wikimedia-search",
    investigationQuery: "retrieved topic",
    investigationQueryIndex: 0,
    evidentiarySuitability: "GENERAL_REFERENCE",
  });
  assert.equal(observedSignals.length, 2);
  assert.equal(observedSignals[0], observedSignals[1]);
  assert.equal(observedSignals[0]?.aborted, false);
});

test("Issue #56: V36 receives explicit unknown publication time rather than page.touched", async () => {
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    clock: () => new Date(fixedTime),
    fetchImpl: async (input) => successfulResponse(input),
  });
  const pipeline = new KnowledgeAcquisitionTruthPipeline(provider);
  const investigated = await pipeline.investigate("issue-56-v36", consultationRequest());
  const source = investigated.snapshot.bundle.sources[0];
  assert.ok(source);
  assert.equal(source.publishedAt, null);
  assert.equal(source.retrievedAt, fixedTime);
  assert.equal(source.metadata.title, "Retrieved topic");
});

test("Issue #57: stalled Wikimedia search is bounded and a later request still succeeds", async () => {
  let stallFirstRequest = true;
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20,
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.ok(init?.signal instanceof AbortSignal);
      if (stallFirstRequest) {
        stallFirstRequest = false;
        return await stallUntilAbort(init.signal);
      }
      return successfulResponse(input);
    },
  });

  await assert.rejects(
    provider.acquire(request("issue-57-timeout")),
    /Knowledge source was unavailable: Knowledge source request exceeded 20 ms\./u,
  );
  assert.equal(calls, 1, "Wikimedia acquisition must not invent a retry after timeout");

  const recovered = await provider.acquire(request("issue-57-recovery"));
  assert.equal(recovered.sources[0]?.sourceId, "page:42");
  assert.equal(recovered.sources[0]?.publishedAt, null);
  assert.equal(calls, 3, "later acquisition should use one search and one detail fetch");
});

test("Issue #57: stalled full-page fetch times out instead of becoming successful fallback", async () => {
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20,
    fetchImpl: async (input, init) => {
      calls += 1;
      const url = new URL(String(input));
      if (!url.searchParams.has("pageids")) return searchResponse();
      assert.ok(init?.signal instanceof AbortSignal);
      return await stallUntilAbort(init.signal);
    },
  });

  await assert.rejects(
    provider.acquire(request("issue-57-detail-timeout")),
    /Knowledge source request exceeded 20 ms/u,
  );
  assert.equal(calls, 2);
});

test("Issue #57: non-timeout detail failure still preserves the already retrieved intro extract", async () => {
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (!url.searchParams.has("pageids")) return searchResponse();
      throw new Error("detail endpoint unavailable");
    },
  });

  const result = await provider.acquire(request("issue-57-detail-fallback"));
  assert.equal(result.sources[0]?.content, "Introductory source report.");
  assert.equal(result.sources[0]?.publishedAt, null);
});

test("Issue #57: Wikimedia timeout configuration is bounded", () => {
  assert.throws(
    () => new WikimediaKnowledgeAcquisitionProvider({ timeoutMs: 0 }),
    /timeoutMs must be an integer between 1 and 120000/u,
  );
  assert.throws(
    () => new WikimediaKnowledgeAcquisitionProvider({ timeoutMs: 120_001 }),
    /timeoutMs must be an integer between 1 and 120000/u,
  );
});
