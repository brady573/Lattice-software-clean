import assert from "node:assert/strict";
import test from "node:test";
import { ConservativeConsultationInterpreter } from "../src/intent/consultation-interpreter.js";
import { GROQ_KNOWLEDGE_SIMPLIFIER_MODEL } from "../src/model/groq-knowledge-simplifier.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  createConfiguredSolandraCognition,
  requireConfiguredSolandraCognition,
} from "../src/solandra/cognition-composition.js";

function developmentConfig(overrides: NodeJS.ProcessEnv = {}): ReturnType<typeof resolveRuntimeConfig> {
  return resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-required-cognition",
    ...overrides,
  });
}

test("Issue #91: canonical Solandra accepts configured model-owned cognition", () => {
  const config = developmentConfig({
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: "g".repeat(32),
  });

  const solandra = requireConfiguredSolandraCognition(config);
  assert.equal(solandra.model, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  assert.ok(solandra.cognition);
  assert.ok(solandra.advisory);
  assert.ok(solandra.actionPreparer);
  assert.ok(solandra.knowledgePresenter);
});

test("Issue #91: canonical Solandra fails explicitly when cognition is not configured", () => {
  const config = developmentConfig();

  assert.equal(createConfiguredSolandraCognition(config), undefined);
  assert.throws(
    () => requireConfiguredSolandraCognition(config),
    /Canonical Solandra requires configured cognition/u,
  );
});

test("Issue #91: explicit noncanonical deterministic interpreter use remains available", async () => {
  const interpreter = new ConservativeConsultationInterpreter();
  const result = await interpreter.interpret({
    message: "Keep this explicit legacy test path.",
    context: [],
  });

  assert.deepEqual(result.objectiveEffect, {
    kind: "ESTABLISH",
    value: "Keep this explicit legacy test path.",
  });
});
