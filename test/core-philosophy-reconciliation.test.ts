import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Core philosophy controls the current Product-design read order and 1.0 definition", async () => {
  const [readme, living, foundational, roadmap, integrity, system, intentDecision, solandra] = await Promise.all([
    source("README.md"),
    source("docs/design/Lattice-Living-Software-Design-to-1.0.md"),
    source("docs/design/Lattice-Foundational-Design-Principle.md"),
    source("docs/ROADMAP.md"),
    source("docs/design/Lattice-Architecture-Integrity.md"),
    source("docs/design/Lattice-System-Architecture.md"),
    source("docs/design/Lattice-Intent-and-Decision-Architecture.md"),
    source("docs/design/solandra/DESIGN.md"),
  ]);

  assert.match(readme, /^# Lattice Software\r?\n\r?\nLattice makes trustworthy knowledge and conditional decision capability/u);
  assert.match(living, /highest Product-design authority and the first filter/u);
  assert.match(living, /trustworthy knowledge plus conditional decision capability/u);
  assert.match(living, /Durable\/versioned structured intent authority.+are implemented/u);
  assert.match(living, /Generalized qualified-criterion comparison/u);
  assert.match(living, /current implemented Product surface is the Core-aligned Conversation \+ Composer design/u);
  assert.doesNotMatch(living, /Lattice 1\.0 is a Trusted Decision Product/u);
  assert.doesNotMatch(living, /Current durable\/versioned structured intent authority is not implemented/u);
  assert.doesNotMatch(living, /weighted preference scoring using current fixture assumptions/u);
  assert.doesNotMatch(living, /Implement the approved offline-prototype UX/u);
  assert.match(foundational, /Knowledge and non-decision Action Preparation have no DecisionPlan/u);
  assert.match(roadmap, /OD-001 — RESOLVED \/ SUPERSEDED BY CORE RECONCILIATION/u);
  assert.doesNotMatch(roadmap, /exactly Listen \/ Current understanding \/ Provide knowledge/u);
  assert.doesNotMatch(roadmap, /Lattice 1\.0 is a \*\*Trusted Decision Product\*\*/u);
  assert.match(integrity, /subordinate to `The-Core-Lattice-Philosophy\.md`/u);

  const coreRead = system.indexOf("docs/design/The-Core-Lattice-Philosophy.md", system.indexOf("## 18. Reading order"));
  const foundationalRead = system.indexOf("docs/design/Lattice-Foundational-Design-Principle.md", coreRead);
  assert.ok(coreRead >= 0 && foundationalRead > coreRead, "System Architecture must direct engineers to the Core first.");
  assert.doesNotMatch(system, /supporting knowledge derived from planning material/u);
  assert.doesNotMatch(system, /next-action presentation derived from `StructuredDecision`/u);
  assert.match(intentDecision, /Lattice makes trustworthy knowledge and conditional decision capability easier to reach/u);
  assert.match(intentDecision, /This document focuses on the qualified decision branch/u);
  assert.doesNotMatch(intentDecision, /Lattice is a Trusted Decision Product/u);
  assert.match(solandra, /V36 authoritative truth -> KnowledgeOutcome/u);
  assert.match(solandra, /V36 authoritative truth -> ActionPreparation \/ Resource/u);
  assert.match(solandra, /when decision work is qualified/u);
  assert.doesNotMatch(solandra, /exact DecisionPlan \/ Run basis\s*\n\s*-> V36 authoritative truth\s*\n\s*-> Lattice Decision Engine/u);
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
