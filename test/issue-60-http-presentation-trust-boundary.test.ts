import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const httpAppSource = readFileSync(new URL("../src/http-app.ts", import.meta.url), "utf8");

test("Issue #60: HTTP presentation does not manufacture KnowledgeOutcome authority from payload shape", () => {
  assert.doesNotMatch(httpAppSource, /as\s+KnowledgeOutcome/u);
  assert.doesNotMatch(httpAppSource, /outcome\s+as\s+\{\s*kind/u);
  assert.match(httpAppSource, /const canonicalOutcome = buildRunOutcome\(run, truth\);/u);
  assert.match(httpAppSource, /if \(canonicalOutcome\.kind !== "KNOWLEDGE"\) return payload;/u);
  assert.match(
    httpAppSource,
    /renderKnowledgeResponseForRun\(canonicalOutcome, run, simplifier\)/u,
  );
});

test("Issue #60: existing typed presentation remains authoritative over the generic hook", () => {
  assert.match(httpAppSource, /if \(hasAssistantPresentation\(payload\)\) return payload;/u);
});
