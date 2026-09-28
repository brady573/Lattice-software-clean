import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("adopted Core philosophy controls the current Product-design read order", async () => {
  const [core, readme] = await Promise.all([
    source("docs/design/The-Core-Lattice-Philosophy.md"),
    source("README.md"),
  ]);

  assert.match(core, /# Trustworthy Intelligence for Action/u);
  assert.match(core, /Question → Understanding → Confidence → Action/u);
  assert.match(core, /What do we know/u);
  assert.match(core, /How do we know it/u);
  assert.match(core, /What can we responsibly do because of it/u);
  assert.match(core, /ILLUSTRATIVE and NON-NORMATIVE/u);
  assert.match(core, /Make trustworthy intelligence usable by anyone/u);

  assert.match(readme, /^# Lattice Software\r?\n\r?\nLattice makes trustworthy intelligence usable by anyone/u);
  assert.match(readme, /Trustworthy Intelligence for Action/u);
  assert.match(readme, /Question → Understanding → Confidence → Action/u);

  for (const doc of [core, readme]) {
    assert.doesNotMatch(doc, /Supreme Product test/u);
    assert.doesNotMatch(doc, /Use knowledge to break down barriers/u);
    assert.doesNotMatch(doc, /intent -> understanding -> informed decision -> authorized action/u);
    assert.doesNotMatch(doc, /serve that journey/u);
  }
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
