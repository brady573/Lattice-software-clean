import assert from "node:assert/strict";
import test from "node:test";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";

const CONTACT_URL = "https://github.com/brady573/Lattice-software-clean";

function searchResponse(pageid: number, title: string): Response {
  return new Response(JSON.stringify({
    query: {
      pages: [{
        pageid,
        index: 1,
        title,
        fullurl: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
        extract: `Introductory source report for ${title}.`,
      }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function detailResponse(pageid: number, title: string): Response {
  return new Response(JSON.stringify({
    query: {
      pages: [{ pageid, title, extract: `Full source report for ${title} with additional detail.` }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function successfulFetch(input: RequestInfo | URL): Response {
  const url = new URL(String(input));
  return url.searchParams.has("pageids")
    ? detailResponse(7, "Recovered topic")
    : searchResponse(7, "Recovered topic");
}

function request(runId: string) {
  return {
    runId,
    objective: "Explain the recovered topic.",
    context: [],
    investigationQueries: ["recovered topic"],
  } as const;
}

test("Wikimedia requests use compliant identification with a stable public contact URL", async () => {
  const agents: Array<string | null> = [];
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    fetchImpl: async (input, init) => {
      agents.push(new Headers(init?.headers).get("user-agent"));
      return successfulFetch(input);
    },
  });

  const result = await provider.acquire(request("wikimedia-contact"));
  assert.deepEqual(result.completion, { status: "COMPLETE" });
  assert.ok(agents.length >= 1);
  for (const agent of agents) {
    assert.ok(agent?.includes(CONTACT_URL), `User-Agent lacks contact URL: ${agent}`);
  }
  assert.equal(
    agents[0],
    `Lattice-Knowledge-Consultation/0.1 (${CONTACT_URL}; source retrieval; no truth authority)`,
  );
});

test("Wikimedia 429 with short Retry-After retries the interrupted request once and proceeds", async () => {
  const waits: number[] = [];
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 5_000,
    delay: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async (input) => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }
      return successfulFetch(input);
    },
  });

  const result = await provider.acquire(request("wikimedia-retry-after"));
  assert.deepEqual(waits, [1_000]);
  assert.deepEqual(result.completion, { status: "COMPLETE" });
  assert.equal(result.sources[0]?.sourceId, "page:7");
  assert.equal(result.sources[0]?.content, "Full source report for Recovered topic with additional detail.");
  assert.equal(calls, 3, "one retried search plus one detail fetch");
});

test("Wikimedia HTTP-date Retry-After is honored within budget", async () => {
  const waits: number[] = [];
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 10_000,
    delay: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async (input) => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": new Date(Date.now() + 2_000).toUTCString() },
        });
      }
      return successfulFetch(input);
    },
  });

  const result = await provider.acquire(request("wikimedia-retry-date"));
  assert.equal(waits.length, 1);
  assert.ok(waits[0] !== undefined && waits[0] >= 0 && waits[0] <= 2_500, `wait was ${waits[0]}`);
  assert.deepEqual(result.completion, { status: "COMPLETE" });
  assert.equal(calls, 3);
});

test("Wikimedia second 429 after the authorized retry stops with no third attempt", async () => {
  const waits: number[] = [];
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20_000,
    delay: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    },
  });

  const result = await provider.acquire(request("wikimedia-no-storm"));
  assert.deepEqual(result.completion, { status: "FAILED", reason: "RATE_LIMITED" });
  assert.deepEqual(result.sources, []);
  assert.equal(calls, 2, "exactly one bounded retry, never a storm");
  assert.deepEqual(waits, [5_000], "absent Retry-After uses the 5 s policy fallback once");
});

test("Wikimedia malformed Retry-After uses the same 5,000 ms fallback", async () => {
  const waits: number[] = [];
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20_000,
    delay: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "not-a-delay" },
      });
    },
  });

  const result = await provider.acquire(request("wikimedia-malformed-retry-after"));
  assert.deepEqual(result.completion, { status: "FAILED", reason: "RATE_LIMITED" });
  assert.deepEqual(waits, [5_000]);
  assert.equal(calls, 2, "malformed instruction still gets exactly one bounded retry");
});

test("Wikimedia 5,000 ms fallback is not waited out when it cannot fit the deadline", async () => {
  const waits: number[] = [];
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 200,
    delay: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    },
  });

  const started = Date.now();
  const result = await provider.acquire(request("wikimedia-fallback-deadline"));
  const elapsed = Date.now() - started;
  assert.deepEqual(result.completion, { status: "FAILED", reason: "RATE_LIMITED" });
  assert.deepEqual(waits, [], "fallback must fail closed rather than exceed the deadline");
  assert.equal(calls, 1, "no retry when the fallback cannot fit");
  assert.ok(elapsed < 5_000, `acquisition timeout must not be extended (took ${elapsed} ms)`);
});

test("Wikimedia Retry-After beyond the remaining budget is not waited out", async () => {
  const waits: number[] = [];
  let calls = 0;
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 200,
    delay: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    },
  });

  const started = Date.now();
  const result = await provider.acquire(request("wikimedia-deadline"));
  const elapsed = Date.now() - started;
  assert.deepEqual(result.completion, { status: "FAILED", reason: "RATE_LIMITED" });
  assert.deepEqual(waits, [], "oversized instruction must not be waited out");
  assert.equal(calls, 1);
  assert.ok(elapsed < 5_000, `acquisition timeout must not be extended (took ${elapsed} ms)`);
});

test("Wikimedia timeout and non-429 failures retain established behavior", async () => {
  const stalled = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 20,
    fetchImpl: async (_input, init) => {
      const signal = init?.signal;
      assert.ok(signal instanceof AbortSignal);
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("aborted"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  });
  const timedOut = await stalled.acquire(request("wikimedia-timeout-unchanged"));
  assert.deepEqual(timedOut.completion, { status: "FAILED", reason: "TIMED_OUT" });

  let failedCalls = 0;
  const failed = new WikimediaKnowledgeAcquisitionProvider({
    timeoutMs: 2_000,
    delay: async () => undefined,
    fetchImpl: async () => {
      failedCalls += 1;
      return new Response("unavailable", { status: 503 });
    },
  });
  const result = await failed.acquire(request("wikimedia-503-unchanged"));
  assert.deepEqual(result.completion, { status: "FAILED", reason: "PROVIDER_FAILURE" });
  assert.equal(failedCalls, 1, "non-429 failures must not gain retries");
});
