import assert from "node:assert/strict";
import test from "node:test";
import type { OutcomeProvenance } from "../src/outcome.js";

const validProvenance: OutcomeProvenance = {
  sourceId: "source-1",
  canonicalUri: "https://example.com/source-1",
  title: "Source 1",
  publisher: null,
  provenanceConfidence: "HIGH",
  authoritativePrimary: false,
  retrievedAt: "2026-09-11T04:00:00.000Z",
  publishedAt: null,
};

// @ts-expect-error Canonical outcome provenance always carries a title.
const missingTitle: OutcomeProvenance = {
  sourceId: "source-2",
  canonicalUri: "https://example.com/source-2",
  publisher: null,
  provenanceConfidence: "HIGH",
  authoritativePrimary: false,
  retrievedAt: "2026-09-11T04:00:00.000Z",
  publishedAt: null,
};

// @ts-expect-error Canonical outcome provenance always carries publishedAt, nullable when unknown.
const missingPublishedAt: OutcomeProvenance = {
  sourceId: "source-3",
  canonicalUri: "https://example.com/source-3",
  title: "Source 3",
  publisher: null,
  provenanceConfidence: "HIGH",
  authoritativePrimary: false,
  retrievedAt: "2026-09-11T04:00:00.000Z",
};

test("Issue #61: canonical outcome provenance requires title and publishedAt", () => {
  assert.equal(validProvenance.title, "Source 1");
  assert.equal(validProvenance.publishedAt, null);
  assert.equal(missingTitle.sourceId, "source-2");
  assert.equal(missingPublishedAt.sourceId, "source-3");
});
