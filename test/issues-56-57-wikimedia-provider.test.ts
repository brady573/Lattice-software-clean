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
      const signal = init?.signal;
      assert.ok(signal instanceof AbortSignal);
      observedSignals.push(signal);
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
      const signal = init?.signal;
      assert.ok(signal instanceof AbortSignal);
      if (stallFirstRequest) {
        stallFirstRequest = false;
        return await stallUntilAbort(signal);
      }
      return successfulResponse(input);
    },
  });

  const timedOut = await provider.acquire(request("issue-57-timeout"));
  assert.deepEqual(timedOut.completion, { status: "FAILED", reason: "TIMED_OUT" });
  assert.deepEqual(timedOut.sources, []);
  assert.deepEqual(timedOut.claims, []);
  assert.equal(calls, 1, "Wikimedia acquisition must not invent a retry after timeout");

  const recovered = await provider.acquire(request("issue-57-recovery"));
  assert.deepEqual(recovered.completion, { status: "COMPLETE" });
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
      const signal = init?.signal;
      assert.ok(signal instanceof AbortSignal);
      return await stallUntilAbort(signal);
    },
  });

  const result = await provider.acquire(request("issue-57-detail-timeout"));
  assert.equal(result.sources[0]?.content, "Introductory source report.");
  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "TIMED_OUT" });
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
  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "PROVIDER_FAILURE" });
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


test("Issue #91: later Wikimedia rate limit preserves already retrieved source material as partial acquisition", async () => {
  let searches = 0;
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20_000,
    delay: async () => undefined,
    fetchImpl: async (input) => {
      calls += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("generator"), "search");
      searches += 1;
      if (searches >= 2) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({
        query: {
          pages: [{
            pageid: 91,
            index: 1,
            title: "Retrieved before interruption",
            fullurl: "https://en.wikipedia.org/wiki/Retrieved_before_interruption",
            extract: "Materially useful introductory source report.",
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await provider.acquire({
    runId: "issue-91-later-rate-limit",
    objective: "Understand an encyclopedic topic.",
    context: [],
    investigationQueries: ["first useful query", "later interrupted query"],
  });

  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "RATE_LIMITED" });
  assert.equal(result.sources[0]?.sourceId, "page:91");
  assert.equal(result.sources[0]?.content, "Materially useful introductory source report.");
  assert.equal(result.claims.length, 1);
  assert.equal(calls, 3, "interrupted search is retried at most once, then stops without detail enrichment or further calls");
});

test("Issue #91: first Wikimedia rate limit remains explicit even when no material was retrieved", async () => {
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20_000,
    delay: async () => undefined,
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    },
  });

  const result = await provider.acquire(request("issue-91-first-rate-limit"));
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.completion, { status: "FAILED", reason: "RATE_LIMITED" });
  assert.equal(calls, 2, "persistent rate limit stops after exactly one bounded retry");
});

test("Issue #91: full-page enrichment is batched instead of multiplying one request per page", async () => {
  let searchNumber = 0;
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    resultLimit: 4,
    fetchImpl: async (input) => {
      calls += 1;
      const url = new URL(String(input));
      const pageIds = url.searchParams.get("pageids");
      if (pageIds) {
        return new Response(JSON.stringify({
          query: {
            pages: pageIds.split("|").map((raw) => ({
              pageid: Number(raw),
              title: `Topic ${raw}`,
              extract: `Full source report ${raw}.`,
            })),
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      searchNumber += 1;
      const base = searchNumber * 100;
      return new Response(JSON.stringify({
        query: {
          pages: [1, 2, 3, 4].map((offset) => ({
            pageid: base + offset,
            index: offset,
            title: `Topic ${base + offset}`,
            fullurl: `https://en.wikipedia.org/wiki/Topic_${base + offset}`,
            extract: `Intro source report ${base + offset}.`,
          })),
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await provider.acquire({
    runId: "issue-91-batched-enrichment",
    objective: "Investigate several source candidates.",
    context: [],
    investigationQueries: ["query one", "query two", "query three", "query four"],
  });

  assert.equal(result.sources.length, 12);
  assert.deepEqual(result.completion, { status: "COMPLETE" });
  assert.equal(searchNumber, 3, "source cap should stop further search work once twelve candidates exist");
  assert.equal(calls, 6, "twelve candidates should require three searches plus three batched detail requests");
});
