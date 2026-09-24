import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const httpAppSource = readFileSync(new URL("../src/http-app.ts", import.meta.url), "utf8");
const intakeSource = readFileSync(new URL("../src/consultation-intake.ts", import.meta.url), "utf8");
const continuationSource = readFileSync(new URL("../src/knowledge/historical-knowledge-continuation.ts", import.meta.url), "utf8");

test("Issue #60: canonical completed Knowledge retains neutral Product-facing presentation", () => {
  assert.match(httpAppSource, /preSerialization/u);
  assert.match(httpAppSource, /\/api\/v1\/runs\/:runId\/outcome/u);
  assert.match(httpAppSource, /buildRunOutcome\(run, truth\)/u);
  assert.match(httpAppSource, /renderKnowledgeResponseForRun\(canonicalOutcome, run\)/u);
  assert.doesNotMatch(
    httpAppSource,
    /ModelAssistanceCapabilityService|modelAssistance|knowledgeSimplifier|SIMPLIFICATION_REQUEST_PATTERN/u,
  );
});

test("Issue #60: historical Knowledge transformation resolves exact governed Knowledge in consultation intake", () => {
  assert.match(intakeSource, /referencedKnowledgeId/u);
  assert.match(intakeSource, /continueHistoricalKnowledge/u);
  // The governed historical reference operation is extracted behind one boundary;
  // exact resolution, presenter capability, and consumed continuity stay intact.
  assert.match(continuationSource, /governedKnowledge\.find/u);
  assert.match(continuationSource, /solandraKnowledgePresenter\.present/u);
  assert.match(continuationSource, /relation: "CONSUMED"/u);
});
