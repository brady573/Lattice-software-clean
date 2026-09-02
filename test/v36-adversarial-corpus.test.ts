import assert from "node:assert/strict";
import test from "node:test";
import { adjudicateClaim } from "../src/truth/adjudication.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { shouldRouteFalsification } from "../src/truth/falsification.js";
import { quantitativeCompatibility } from "../src/truth/numerical.js";
import { evaluatePositiveBurden } from "../src/truth/positive-burden.js";
import { dedupeArtifactsByHash, deriveProvenanceComponentMap, recoverOriginalArtifact } from "../src/truth/provenance.js";
import type { ClaimEvidence, ClaimType, CompiledClaim, ProofCheck, ProofCheckStatus, ProofObligation, SourceArtifact, SourceEdge } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000336";

export const v36AdversarialFamilies = [
  "syndication-copy",
  "source-alias",
  "citation-laundering",
  "paraphrased-copy",
  "stale-current",
  "denominator-trick",
  "causal-confounding",
  "context-omission",
  "authenticity-tamper",
  "false-consensus",
  "contradiction-suppression",
  "correction-hidden",
  "rediscovery",
  "unknown-provenance",
] as const;

function claim(claimType: ClaimType): CompiledClaim {
  return {
    id: `claim-${claimType}`,
    runId,
    text: `material ${claimType} claim`,
    claimType,
    scope: "prototype",
    effectiveAt: null,
    jurisdiction: null,
    unit: claimType === "QUANTITATIVE" ? "%" : null,
    denominator: claimType === "QUANTITATIVE" ? "population" : null,
    baseline: claimType === "QUANTITATIVE" ? "baseline" : null,
    period: claimType === "QUANTITATIVE" ? "period" : null,
    causalRelation: claimType === "CAUSAL" ? "causes" : null,
    authenticityTarget: claimType === "AUTHENTICITY" ? "artifact" : null,
    comparisonClass: null,
    quotedContext: null,
    qualifiers: [],
    evidenceRisk: "ORDINARY",
  };
}

function evidence(
  id: string,
  claimId: string,
  relation: "SUPPORTS" | "CONTRADICTS",
  component: string | null,
  options: { primary?: boolean; verification?: "VERIFIED" | "UNVERIFIED" | "REJECTED" } = {},
): ClaimEvidence {
  const verification = options.verification ?? "VERIFIED";
  return {
    id: `ce-${id}`,
    runId,
    claimId,
    artifactId: `artifact-${id}`,
    externalEvidenceId: id,
    relation,
    specificEvidence: id,
    provenanceComponentKey: component,
    provenanceConfidence: component ? "HIGH" : "UNKNOWN",
    authoritativePrimary: options.primary ?? false,
    researchQuestionId: null,
    verification,
    admitted: verification !== "REJECTED",
    rejectionReason: verification === "REJECTED" ? "rejected" : null,
  };
}

function assess(
  claimType: ClaimType,
  items: ClaimEvidence[],
  statuses: Partial<Record<string, ProofCheckStatus>> = {},
  materiallyMisleading = false,
) {
  const subject = claim(claimType);
  const obligations: ProofObligation[] = requiredProofObligations(claimType).map((kind, index) => ({
    id: `ob-${claimType}-${index}`,
    runId,
    claimId: subject.id,
    kind,
    required: true,
  }));
  const checks: ProofCheck[] = obligations.map((obligation, index) => ({
    id: `check-${claimType}-${index}`,
    runId,
    obligationId: obligation.id,
    kind: obligation.kind,
    status: statuses[obligation.kind] ?? "PASSED",
    evidenceIds: items.map((item) => item.externalEvidenceId),
    explanation: null,
  }));
  return adjudicateClaim({
    assessmentId: `assessment-${claimType}`,
    claim: subject,
    obligations,
    checks,
    evidence: items.map((item) => ({ ...item, claimId: subject.id })),
    materiallyMisleading,
  });
}

function artifact(id: string, component: string, hash = `hash-${id}`): SourceArtifact {
  return {
    id,
    runId,
    canonicalUri: `fixture://${id}`,
    artifactHash: hash,
    publisher: "fixture",
    originKey: id,
    provenanceComponentKey: component,
    provenanceConfidence: "HIGH",
    authoritativePrimary: false,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "text/plain",
    metadata: {},
    untrusted: true,
  };
}

function edge(from: string, to: string, edgeType: SourceEdge["edgeType"]): SourceEdge {
  return {
    id: `edge-${edgeType}`,
    runId,
    fromArtifactId: from,
    toArtifactId: to,
    edgeType,
    confidence: 0.99,
    contentSimilarity: 0.99,
  };
}

test("V36 adversarial corpus contains the complete fixed prototype family set", () => {
  assert.equal(v36AdversarialFamilies.length, 14);
  assert.equal(new Set(v36AdversarialFamilies).size, 14);
});

test("syndication-copy: syndicated reports collapse to one provenance component", () => {
  const a = artifact("a", "raw-a");
  const b = artifact("b", "raw-b");
  const map = deriveProvenanceComponentMap([a, b], [edge("a", "b", "SYNDICATES")]);
  assert.equal(map.get("a"), map.get("b"));
});

test("source-alias: separate URLs assigned the same origin do not count twice", () => {
  const a = artifact("alias-a", "shared-origin");
  const b = artifact("alias-b", "shared-origin");
  const map = deriveProvenanceComponentMap([a, b], []);
  assert.equal(map.get("alias-a"), map.get("alias-b"));
});

test("citation-laundering: derivative citation recovers the upstream original", () => {
  const derivative = artifact("derivative", "raw-d");
  const original = artifact("original", "raw-o");
  assert.equal(
    recoverOriginalArtifact("derivative", [derivative, original], [edge("derivative", "original", "DERIVES_FROM")])?.id,
    "original",
  );
});

test("paraphrased-copy: copied content connected by provenance does not create independence", () => {
  const a = artifact("paraphrase-a", "raw-a");
  const b = artifact("paraphrase-b", "raw-b");
  const map = deriveProvenanceComponentMap([a, b], [edge("paraphrase-a", "paraphrase-b", "COPIES")]);
  assert.equal(map.get("paraphrase-a"), map.get("paraphrase-b"));
});

test("stale-current: failed temporal applicability yields OUTDATED", () => {
  const subject = claim("CURRENT_STATE");
  const result = assess(
    "CURRENT_STATE",
    [evidence("current", subject.id, "SUPPORTS", "origin-a", { primary: true })],
    { TEMPORAL_APPLICABILITY: "FAILED" },
  );
  assert.equal(result.verdict, "OUTDATED");
});

test("denominator-trick: incompatible denominator cannot masquerade as the same quantity", () => {
  const result = quantitativeCompatibility(
    { value: 50, unit: "%", denominator: "all-users", baseline: "2025", period: "Q1" },
    { value: 50, unit: "%", denominator: "active-users", baseline: "2025", period: "Q1" },
  );
  assert.deepEqual(result.failures, ["DENOMINATOR"]);
});

test("causal-confounding: failed alternative-explanations obligation blocks TRUE", () => {
  const subject = claim("CAUSAL");
  const result = assess(
    "CAUSAL",
    [
      evidence("causal-a", subject.id, "SUPPORTS", "origin-a"),
      evidence("causal-b", subject.id, "SUPPORTS", "origin-b"),
    ],
    { ALTERNATIVE_EXPLANATIONS: "FAILED" },
  );
  assert.equal(result.verdict, "UNVERIFIED");
});

test("context-omission: material omission produces MISLEADING instead of TRUE", () => {
  const subject = claim("INTERPRETIVE");
  const result = assess(
    "INTERPRETIVE",
    [evidence("context", subject.id, "SUPPORTS", "origin-a", { primary: true })],
    {},
    true,
  );
  assert.equal(result.verdict, "MISLEADING");
});

test("authenticity-tamper: failed content integrity blocks positive authenticity", () => {
  const subject = claim("AUTHENTICITY");
  const result = assess(
    "AUTHENTICITY",
    [
      evidence("auth-a", subject.id, "SUPPORTS", "origin-a"),
      evidence("auth-b", subject.id, "SUPPORTS", "origin-b"),
    ],
    { CONTENT_INTEGRITY: "FAILED" },
  );
  assert.equal(result.verdict, "UNVERIFIED");
});

test("false-consensus: repeated support from one origin does not satisfy high-risk positive burden", () => {
  const subject = claim("CAUSAL");
  const items = [
    evidence("consensus-a", subject.id, "SUPPORTS", "origin-a"),
    evidence("consensus-b", subject.id, "SUPPORTS", "origin-a"),
    evidence("consensus-c", subject.id, "SUPPORTS", "origin-a"),
  ];
  assert.equal(evaluatePositiveBurden(subject, items).satisfied, false);
});

test("contradiction-suppression: important positive claims are routed to falsification", () => {
  const subject = claim("CAUSAL");
  assert.equal(
    shouldRouteFalsification(subject, [evidence("support", subject.id, "SUPPORTS", "origin-a")]),
    true,
  );
});

test("correction-hidden: a discovered current-state temporal invalidation cannot remain TRUE", () => {
  const subject = claim("CURRENT_STATE");
  const result = assess(
    "CURRENT_STATE",
    [evidence("old-state", subject.id, "SUPPORTS", "origin-a", { primary: true })],
    { TEMPORAL_APPLICABILITY: "FAILED", HISTORICAL_CURRENT_COMPARISON: "FAILED" },
  );
  assert.equal(result.verdict, "OUTDATED");
});

test("rediscovery: identical artifacts do not accumulate as multiple evidence artifacts", () => {
  const first = artifact("first", "origin-a", "same-hash");
  const rediscovered = artifact("rediscovered", "origin-a", "same-hash");
  assert.equal(dedupeArtifactsByHash([first, rediscovered]).length, 1);
});

test("unknown-provenance: unknown origin cannot satisfy ordinary positive burden", () => {
  const subject = claim("FACTUAL");
  const item = evidence("unknown", subject.id, "SUPPORTS", null, { primary: true });
  assert.equal(evaluatePositiveBurden(subject, [item]).satisfied, false);
});
