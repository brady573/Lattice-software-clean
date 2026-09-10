import assert from "node:assert/strict";
import test from "node:test";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";

const fixedTime = "2026-09-10T12:00:00.000Z";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("Wikimedia explanatory acquisition can select responsive material beyond the article introduction", async () => {
  const requests: URL[] = [];
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    resultLimit: 1,
    clock: () => new Date(fixedTime),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.searchParams.get("pageids") === "7454563") {
        return jsonResponse({
          query: {
            pages: [{
              pageid: 7454563,
              title: "Autumn leaf color",
              extract: [
                "Autumn leaf color is the seasonal change in leaf appearance.",
                "In autumn, shorter daylight and cooling temperatures cause leaf pigments to change as chlorophyll breaks down and other colors become visible.",
              ].join("\n\n"),
            }],
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [{
            pageid: 7454563,
            index: 1,
            title: "Autumn leaf color",
            fullurl: "https://en.wikipedia.org/wiki/Autumn_leaf_color",
            touched: "2026-09-09T14:17:41.000Z",
            extract: "Autumn leaf color is the seasonal change in leaf appearance.",
          }],
        },
      });
    },
  });

  const result = await provider.acquire({
    runId: "responsive-passage-run",
    objective: "Why do leaves change color in autumn?",
    context: [],
    investigationQueries: ["leaves change color autumn"],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.searchParams.get("exintro"), "1");
  assert.equal(requests[1]?.searchParams.has("exintro"), false);
  assert.equal(result.sources[0]?.content.includes("shorter daylight"), true);
  assert.match(result.claims[0]?.text ?? "", /shorter daylight.*cause.*leaf pigments.*change/iu);
  assert.equal(result.sources[0]?.metadata?.evidentiarySuitability, "GENERAL_REFERENCE");
});

test("Wikimedia explanatory passage selection remains generic across a second domain", async () => {
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    resultLimit: 1,
    clock: () => new Date(fixedTime),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("pageids") === "78031979") {
        return jsonResponse({
          query: {
            pages: [{
              pageid: 78031979,
              title: "Road salt",
              extract: [
                "Road salt is used in winter road maintenance.",
                "The salt lowers the freezing point of water, allowing road ice to melt and reducing refreezing under suitable conditions.",
              ].join("\n\n"),
            }],
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [{
            pageid: 78031979,
            index: 1,
            title: "Road salt",
            fullurl: "https://en.wikipedia.org/wiki/Road_salt",
            touched: "2026-09-09T14:17:41.000Z",
            extract: "Road salt is used in winter road maintenance.",
          }],
        },
      });
    },
  });

  const result = await provider.acquire({
    runId: "road-salt-responsive-passage-run",
    objective: "Why does salt melt ice on roads?",
    context: [],
    investigationQueries: ["salt melt ice roads"],
  });

  assert.match(result.claims[0]?.text ?? "", /lowers the freezing point.*ice to melt/iu);
});
