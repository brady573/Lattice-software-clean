import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Core philosophy controls the current Product-design read order and 1.0 definition", async () => {
  const [readme, living, foundational, roadmap, integrity, intentDecision, solandra] = await Promise.all([
    source("README.md"),
    source("docs/design/Lattice-Living-Software-Design-to-1.0.md"),
    source("docs/design/Lattice-Foundational-Design-Principle.md"),
    source("docs/ROADMAP.md"),
    source("docs/design/Lattice-Architecture-Integrity.md"),
    source("docs/design/Lattice-Intent-and-Decision-Architecture.md"),
    source("docs/design/solandra/DESIGN.md"),
  ]);

  assert.match(readme, /^# Lattice Software\r?\n\r?\nLattice makes trustworthy knowledge and conditional decision capability/u);

  assert.match(living, /`The-Core-Lattice-Philosophy\.md` remains unchanged and highest authority/u);
  assert.match(living, /This living design is subordinate to the Core/u);
  assert.match(living, /Lattice 1\.0 is a trustworthy conversational Product/u);
  assert.match(living, /the person talks naturally with Solandra/u);
  assert.match(living, /Lattice preserves intent integrity and turns information into governed Knowledge/u);
  assert.match(living, /Recommendation is not Authorization/u);
  assert.match(
    living,
    /The primary experience remains:[\s\S]*\*\*Conversation\*\*[\s\S]*\*\*free-form ConversationInput\*\*[\s\S]*\*\*adaptive Composer\*\*/u,
  );
  assert.match(living, /Do not use generated prose, telemetry, or presentation state as a second authority/u);
  assert.doesNotMatch(living, /Lattice 1\.0 is a Trusted Decision Product/u);

  assert.match(foundational, /`The-Core-Lattice-Philosophy\.md` remains unchanged and is the highest Product authority/u);
  assert.match(foundational, /must never be used to override it/u);
  assert.match(foundational, /natural relationship with Solandra, not a control panel/u);
  assert.match(foundational, /conversation != canonical intent/u);
  assert.match(foundational, /information != Knowledge/u);
  assert.match(foundational, /Knowledge != Recommendation/u);
  assert.match(foundational, /Recommendation != Authorization/u);
  assert.match(foundational, /Authorization != Execution/u);
  assert.match(foundational, /ExecutionReceipt != Verification/u);

  assert.match(roadmap, /SUBORDINATE TO THE CORE LATTICE PHILOSOPHY/u);
  assert.match(roadmap, /The-Core-Lattice-Philosophy\.md[^\n]+highest Product philosophy authority/u);
  assert.match(integrity, /subordinate to `The-Core-Lattice-Philosophy\.md`/u);

  assert.match(intentDecision, /Recommendation is not the person's decision/u);
  assert.match(intentDecision, /the person's decision is not action Authorization/u);
  assert.match(intentDecision, /No `DecisionPlan` or formal Decision Engine is required on this ordinary path/u);

  assert.match(solandra, /This visual design is subordinate to the Core/u);
  assert.match(solandra, /No visual layer may strengthen upstream trust state/u);
  assert.match(solandra, /These are rendering capabilities, not stages/u);
});

test("canonical RuntimeApp composition names only the canonical HTTP builder", async () => {
  const [runtime, canonicalHttp, httpCore, intake, legacy] = await Promise.all([
    source("src/runtime-app.ts"),
    source("src/http-app.ts"),
    source("src/http-core.ts"),
    source("src/consultation-intake.ts"),
    source("src/legacy/legacy-test-app.ts"),
  ]);
  assert.match(runtime, /buildCanonicalApp/u);
  assert.doesNotMatch(runtime, /legacy-test-app|development-prototype-app|android-model-prototype/u);
  assert.doesNotMatch(canonicalHttp, /\/runs"|\/messages"|\/prototype\//u);
  assert.doesNotMatch(httpCore, /\/api\/v1\/runs\/:runId\/result/u);
  assert.match(intake, /\/api\/v1\/runs\/:runId\/outcome/u);
  assert.match(legacy, /\/api\/v1\/runs\/:runId\/result/u);
});
