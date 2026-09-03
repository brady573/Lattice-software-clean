import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Core philosophy controls the current Product-design read order and 1.0 definition", async () => {
  const [readme, living, foundational, roadmap, integrity, system] = await Promise.all([
    source("README.md"),
    source("docs/design/Lattice-Living-Software-Design-to-1.0.md"),
    source("docs/design/Lattice-Foundational-Design-Principle.md"),
    source("docs/ROADMAP.md"),
    source("docs/design/Lattice-Architecture-Integrity.md"),
    source("docs/design/Lattice-System-Architecture.md"),
  ]);

  assert.match(readme, /^# Lattice Software\n\nLattice makes trustworthy knowledge and conditional decision capability/u);
  assert.match(living, /highest Product-design authority and the first filter/u);
  assert.match(living, /trustworthy knowledge plus conditional decision capability/u);
  assert.doesNotMatch(living, /Lattice 1\.0 is a Trusted Decision Product/u);
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
});

test("canonical RuntimeApp composition names only the canonical HTTP builder", async () => {
  const [runtime, canonicalHttp] = await Promise.all([
    source("src/runtime-app.ts"),
    source("src/http-app.ts"),
  ]);
  assert.match(runtime, /buildCanonicalApp/u);
  assert.doesNotMatch(runtime, /legacy-test-app|development-prototype-app|android-model-prototype/u);
  assert.doesNotMatch(canonicalHttp, /\/runs"|\/messages"|\/prototype\//u);
});
