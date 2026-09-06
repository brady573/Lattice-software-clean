import assert from "node:assert/strict";
import test from "node:test";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";

test("A1 Wikimedia retrieval declares general-reference suitability without claiming truth authority", async () => {
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    fetchImpl: async () => new Response(JSON.stringify({
      query: {
        pages: [{
          pageid: 123,
          index: 1,
          title: "Example topic",
          fullurl: "https://en.wikipedia.org/wiki/Example_topic",
          touched: "2026-09-01T00:00:00.000Z",
          extract: "Example topic material provides a relevant source report.",
        }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
    clock: () => new Date("2026-09-06T17:00:00.000Z"),
  });

  const result = await provider.acquire({
    runId: "a1-source-suitability",
    objective: "Explain example topic material.",
    context: [],
  });

  assert.equal(result.sources[0]?.metadata?.evidentiarySuitability, "GENERAL_REFERENCE");
  assert.equal("authoritativePrimary" in (result.sources[0]?.metadata ?? {}), false);
  assert.equal("verified" in (result.sources[0]?.metadata ?? {}), false);
  assert.equal("truth" in (result.sources[0]?.metadata ?? {}), false);
});
