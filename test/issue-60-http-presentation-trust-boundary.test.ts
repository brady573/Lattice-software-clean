import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const httpAppSource = readFileSync(new URL("../src/http-app.ts", import.meta.url), "utf8");
const intakeSource = readFileSync(new URL("../src/consultation-intake.ts", import.meta.url), "utf8");

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
  assert.match(intakeSource, /cognitiveGovernedKnowledge\.find/u);
  assert.match(intakeSource, /solandraKnowledgePresenter\.present/u);
  assert.match(intakeSource, /relation: "CONSUMED"/u);
});
