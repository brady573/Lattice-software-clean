import assert from "node:assert/strict";
import test from "node:test";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  DeterministicKnowledgeInvestigationQueryDeriver,
  ObjectiveKnowledgeRelevanceQualifier,
  RelevantKnowledgeAcquisitionProvider,
} from "../src/knowledge/investigation.js";
import { renderKnowledgeResponse } from "../src/presentation/solandra/knowledge-response.js";
import type { KnowledgeOutcome } from "../src/outcome.js";

const fixedTime = "2026-09-04T22:00:00.000Z";

function source(sourceId: string, title: string, content: string) {
  return {
    sourceId,
    canonicalUri: `https://knowledge.example/${sourceId}`,
    title,
    publisher: "Knowledge Example",
    retrievedAt: fixedTime,
    publishedAt: "2026-09-01T00:00:00.000Z",
    contentType: "text/plain",
    content,
  };
}

function claim(sourceId: string, claimId: string, text: string) {
  return {
    claimId,
    text,
    claimType: "INTERPRETIVE" as const,
    evidence: [{ sourceId, relation: "SUPPORTS" as const, excerpt: text }],
  };
}

class RecordingProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "recording-direction-fixture";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  constructor(private readonly result: KnowledgeAcquisitionResult) {}

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.result);
  }
}

test("cause-seeking relevance rejects reverse and unsupported direction while accepting an explanation of the requested phenomenon", () => {
  const objective = "Why do leaves change color in autumn?";
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = deriver.derive({ objective, context: [] });
  const reverse = source(
    "reverse",
    "Autumn tourism",
    "Tourism increases because leaves change color in autumn.",
  );
  const unsupportedDirection = source(
    "unsupported-direction",
    "Autumn tourism",
    "Leaves change color in autumn, leading to increased tourism.",
  );
  const responsive = source(
    "responsive",
    "Seasonal leaf change",
    "Leaves change color in autumn because seasonal changes affect leaf pigments.",
  );

  const reverseDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: reverse,
    claim: claim(reverse.sourceId, "reverse-claim", reverse.content),
  });
  const unsupportedDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: unsupportedDirection,
    claim: claim(unsupportedDirection.sourceId, "unsupported-direction-claim", unsupportedDirection.content),
  });
  const responsiveDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: responsive,
    claim: claim(responsive.sourceId, "responsive-claim", responsive.content),
  });

  assert.equal(reverseDisposition.relevant, false);
  assert.match(reverseDisposition.rationale, /required direction/iu);
  assert.equal(unsupportedDisposition.relevant, false);
  assert.match(unsupportedDisposition.rationale, /required direction/iu);
  assert.equal(responsiveDisposition.relevant, true);
  assert.match(responsiveDisposition.rationale, /requested explanatory relationship/iu);
});

test("unknown causal direction fails closed outside the leaf fixture domain", () => {
  const objective = "Why does condensation form?";
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = deriver.derive({ objective, context: [] });
  const unsupportedDirection = source(
    "condensation-effect",
    "Condensation and surfaces",
    "Condensation forming leads to slippery surfaces.",
  );
  const responsive = source(
    "condensation-cause",
    "Condensation formation",
    "Condensation can form because water vapor cools and changes phase.",
  );

  const unsupportedDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: unsupportedDirection,
    claim: claim(unsupportedDirection.sourceId, "condensation-effect-claim", unsupportedDirection.content),
  });
  const responsiveDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: responsive,
    claim: claim(responsive.sourceId, "condensation-cause-claim", responsive.content),
  });

  assert.equal(unsupportedDisposition.relevant, false);
  assert.equal(responsiveDisposition.relevant, true);
});

test("require/react cues cannot bypass cause-seeking direction qualification", () => {
  const objective = "Why can database indexes make writes slower?";
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = deriver.derive({ objective, context: [] });
  const unsupportedDirection = source(
    "require-bypass",
    "Index requirements and write speed",
    "Fast query plans require database indexes, and writes can be slower.",
  );
  const disposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: unsupportedDirection,
    claim: claim(unsupportedDirection.sourceId, "require-bypass-claim", unsupportedDirection.content),
  });

  assert.equal(disposition.relevant, false);
  assert.match(disposition.rationale, /required direction/iu);
});

test("passive causal forms require the requested phenomenon on the explained subject side", () => {
  const objective = "Why does flooding happen?";
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = deriver.derive({ objective, context: [] });
  const reversePassive = source(
    "reverse-passive",
    "Flooding causes and road impacts",
    "Road closures are caused by flooding.",
  );
  const supportedPassive = source(
    "supported-passive",
    "Flood causes",
    "Flooding is caused by prolonged heavy rainfall.",
  );
  const ambiguousSibling = source(
    "affected-passive",
    "Flooding causes and traffic impacts",
    "Traffic is affected by flooding.",
  );
  const supportedResultFrom = source(
    "result-from",
    "Flood causes",
    "Flooding results from prolonged heavy rainfall.",
  );

  const reverseDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: reversePassive,
    claim: claim(reversePassive.sourceId, "reverse-passive-claim", reversePassive.content),
  });
  const supportedDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: supportedPassive,
    claim: claim(supportedPassive.sourceId, "supported-passive-claim", supportedPassive.content),
  });
  const siblingDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: ambiguousSibling,
    claim: claim(ambiguousSibling.sourceId, "affected-passive-claim", ambiguousSibling.content),
  });
  const resultFromDisposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: supportedResultFrom,
    claim: claim(supportedResultFrom.sourceId, "result-from-claim", supportedResultFrom.content),
  });

  assert.equal(reverseDisposition.relevant, false);
  assert.match(reverseDisposition.rationale, /required direction/iu);
  assert.equal(supportedDisposition.relevant, true);
  assert.match(supportedDisposition.rationale, /requested explanatory relationship/iu);
  assert.equal(siblingDisposition.relevant, false);
  assert.match(siblingDisposition.rationale, /required direction/iu);
  assert.equal(resultFromDisposition.relevant, true);
});

test("passive reverse causality is filtered before V36 while supported direction survives", async () => {
  const objective = "Why does flooding happen?";
  const reversePassive = source(
    "reverse-passive",
    "Road impacts",
    "Road closures are caused by flooding.",
  );
  const supportedPassive = source(
    "supported-passive",
    "Flood causes",
    "Flooding is caused by prolonged heavy rainfall.",
  );
  const provider = new RecordingProvider({
    sources: [reversePassive, supportedPassive],
    claims: [
      claim(reversePassive.sourceId, "reverse-passive-claim", reversePassive.content),
      claim(supportedPassive.sourceId, "supported-passive-claim", supportedPassive.content),
    ],
  });
  const wrapped = new RelevantKnowledgeAcquisitionProvider(provider);

  const result = await wrapped.acquire({ runId: "run-passive-direction", objective, context: [] });

  assert.equal(provider.requests.length, 1);
  assert.deepEqual(result.sources.map((item) => item.sourceId), ["supported-passive"]);
  assert.deepEqual(result.claims.map((item) => item.claimId), ["supported-passive-claim"]);
});

test("directional answer relevance filters reverse and unsupported causality before V36", async () => {
  const objective = "Why do leaves change color in autumn?";
  const reverse = source(
    "reverse",
    "Autumn tourism",
    "Tourism increases because leaves change color in autumn.",
  );
  const unsupportedDirection = source(
    "unsupported-direction",
    "Autumn tourism",
    "Leaves change color in autumn, leading to increased tourism.",
  );
  const responsive = source(
    "responsive",
    "Seasonal leaf change",
    "Leaves change color in autumn because seasonal changes affect leaf pigments.",
  );
  const provider = new RecordingProvider({
    sources: [reverse, unsupportedDirection, responsive],
    claims: [
      claim(reverse.sourceId, "reverse-claim", reverse.content),
      claim(unsupportedDirection.sourceId, "unsupported-direction-claim", unsupportedDirection.content),
      claim(responsive.sourceId, "responsive-claim", responsive.content),
    ],
  });
  const wrapped = new RelevantKnowledgeAcquisitionProvider(provider);

  const result = await wrapped.acquire({
    runId: "run-causal-direction",
    objective,
    context: [],
  });

  assert.equal(provider.requests.length, 1);
  assert.deepEqual(result.sources.map((item) => item.sourceId), ["responsive"]);
  assert.deepEqual(result.claims.map((item) => item.claimId), ["responsive-claim"]);
  assert.equal(result.claims[0]?.evidence[0]?.sourceId, "responsive");
});

test("effects-seeking objectives do not silently inherit the cause-seeking contract", () => {
  const objective = "What are the effects of insulation?";
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = deriver.derive({ objective, context: [] });
  const candidate = source(
    "effects",
    "Insulation effects",
    "Insulation causes lower heat transfer through a wall.",
  );
  const disposition = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: candidate,
    claim: claim(candidate.sourceId, "effects-claim", candidate.content),
  });

  assert.equal(disposition.relevant, true);
  assert.match(disposition.rationale, /overlaps the objective-specific or derived investigation concepts/iu);
  assert.doesNotMatch(disposition.rationale, /requested explanatory relationship|required direction/iu);

  const emptyOutcome = {
    kind: "KNOWLEDGE",
    objective,
    findings: [],
    evidence: [],
    provenance: [],
    uncertainties: ["No validated external findings are sufficiently relevant to this objective."],
  } as unknown as KnowledgeOutcome;
  assert.equal(
    renderKnowledgeResponse(emptyOutcome),
    "No validated external findings are sufficiently relevant to this objective.",
  );
  assert.doesNotMatch(renderKnowledgeResponse(emptyOutcome), /why this happens/iu);
});
