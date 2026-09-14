import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";

const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);

const cases = [
  {
    question: "What started World War I?",
    runId: "07e018af-abcc-cf5e-ce7f-65fb908b0108",
    queries: [
      "primary causes of World War I political factors",
      "military alliances and mobilization plans leading to World War I",
      "social and economic tensions in Europe before 1914",
      "triggering event of World War I assassination of Archduke Franz Ferdinand",
      "role of nationalism in the outbreak of World War I",
      "impact of imperial rivalries on the start of World War I",
      "influence of arms race and militarism on the onset of World War I",
      "timeline of events from June 1914 to July 1914 leading to war declaration",
    ],
  },
  {
    question: "How does nuclear fission work?",
    runId: "a4eae1e7-f78f-feea-e118-71ad57b8c100",
    queries: [
      "nuclear fission process description",
      "how chain reaction occurs in nuclear fission",
      "neutron capture mechanism in nuclear fission",
      "energy release during nuclear fission reactions",
      "common fissile isotopes used in nuclear fission such as uranium-235",
      "applications of nuclear fission in power generation and weapons",
    ],
  },
];

const artifactDir = resolve(process.env.DIAGNOSTIC_ARTIFACT_DIR ?? "../artifacts/issue91-wikimedia-http-continuation");
mkdirSync(artifactDir, { recursive: true });
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  purpose: "Changed diagnostic observability only: replay exact retrieval queries from accepted trace through unchanged Wikimedia adapter and record internal HTTP responses before any later provider throw.",
  semantics: {
    queryChanges: false,
    resultLimitChanges: false,
    retriesAdded: false,
    pacingAdded: false,
    providerChanges: false,
  },
  cases: [],
};

function bound(value, max = 1200) {
  if (typeof value !== "string") return value;
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…[bounded]`;
}

function summarizeJson(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return { parseError: true, bodyExcerpt: bound(text, 800) };
  }
  const pages = Array.isArray(root?.query?.pages) ? root.query.pages : [];
  return {
    pageCount: pages.length,
    pages: pages.map((page) => ({
      pageid: page?.pageid ?? null,
      index: page?.index ?? null,
      title: typeof page?.title === "string" ? page.title : null,
      fullurl: typeof page?.fullurl === "string" ? page.fullurl : null,
      extractExcerpt: typeof page?.extract === "string" ? bound(page.extract, 1400) : null,
    })),
    apiError: root?.error ?? null,
  };
}

function requestKind(url) {
  if (url.searchParams.get("generator") === "search") return "SEARCH";
  if (url.searchParams.get("pageids")) return "FULL_EXTRACT";
  return "OTHER";
}

for (const inputCase of cases) {
  const trace = {
    question: inputCase.question,
    runId: inputCase.runId,
    queries: inputCase.queries,
    http: [],
    providerResult: null,
    providerError: null,
  };
  evidence.cases.push(trace);
  const pendingCaptures = [];

  const recordingFetch = async (input, init) => {
    const response = await fetch(input, init);
    const urlText = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    const url = new URL(urlText);
    const record = {
      sequence: trace.http.length + 1,
      kind: requestKind(url),
      status: response.status,
      ok: response.ok,
      searchQuery: url.searchParams.get("gsrsearch"),
      pageId: url.searchParams.get("pageids"),
      requestUrl: url.href,
      response: null,
    };
    trace.http.push(record);
    const capture = response.clone().text().then((text) => {
      record.response = summarizeJson(text);
    }).catch((error) => {
      record.response = { captureError: error instanceof Error ? error.message : String(error) };
    });
    pendingCaptures.push(capture);
    return response;
  };

  const provider = new WikimediaKnowledgeAcquisitionProvider({ fetchImpl: recordingFetch });
  try {
    const result = await provider.acquire({
      runId: inputCase.runId,
      objective: inputCase.question,
      context: [],
      investigationQueries: inputCase.queries,
    });
    trace.providerResult = {
      sourceCount: result.sources.length,
      candidateClaimCount: result.claims.length,
      sources: result.sources.map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        canonicalUri: source.canonicalUri,
        investigationQuery: source.metadata?.investigationQuery ?? null,
        contentExcerpt: bound(source.content, 1600),
      })),
      claims: result.claims.map((claim) => ({
        claimId: claim.claimId,
        text: bound(claim.text, 1200),
        evidence: claim.evidence.map((item) => ({
          sourceId: item.sourceId,
          relation: item.relation,
          excerpt: bound(item.excerpt, 1200),
        })),
      })),
    };
  } catch (error) {
    trace.providerError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  await Promise.allSettled(pendingCaptures);
  console.log(`ISSUE91_WIKIMEDIA_HTTP=${JSON.stringify(trace)}`);
}

writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(`ISSUE91_WIKIMEDIA_HTTP_COMPLETE=${JSON.stringify({ product: evidence.product, caseCount: evidence.cases.length })}`);
