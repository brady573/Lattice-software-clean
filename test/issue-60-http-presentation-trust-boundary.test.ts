import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const httpAppSource = readFileSync(new URL("../src/http-app.ts", import.meta.url), "utf8");
const intakeSource = readFileSync(new URL("../src/consultation-intake.ts", import.meta.url), "utf8");

test("Issue #60: canonical HTTP serialization has no predecessor Model-assistance transformation hook", () => {
  assert.doesNotMatch(httpAppSource, /preSerialization/u);
  assert.doesNotMatch(httpAppSource, /modelAssistance|knowledgeSimplifier|renderKnowledgeResponseForRun/u);
  assert.doesNotMatch(httpAppSource, /as\s+KnowledgeOutcome/u);
});

test("Issue #60: historical Knowledge transformation resolves exact governed Knowledge in consultation intake", () => {
  assert.match(intakeSource, /referencedKnowledgeId/u);
  assert.match(intakeSource, /cognitiveGovernedKnowledge\.find/u);
  assert.match(intakeSource, /solandraKnowledgePresenter\.present/u);
  assert.match(intakeSource, /relation: "CONSUMED"/u);
});
