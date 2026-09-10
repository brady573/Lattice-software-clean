import assert from "node:assert/strict";
import test from "node:test";
import {
  DeterministicKnowledgeInvestigationQueryDeriver,
  ObjectiveKnowledgeRelevanceQualifier,
} from "../src/knowledge/investigation.js";

const CASES = [
  {
    objective: "I need to know how to prepare my soil for sod.",
    required: [/prepare/iu, /soil/iu, /sod/iu],
  },
  {
    objective: "I need to know how to season a cast iron skillet.",
    required: [/season/iu, /cast/iu, /iron/iu, /skillet/iu],
  },
] as const;

const fixedTime = "2026-09-10T15:00:00.000Z";

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

function claim(sourceId: string, text: string) {
  return {
    claimId: `${sourceId}-claim`,
    text,
    claimType: "INTERPRETIVE" as const,
    evidence: [{ sourceId, relation: "SUPPORTS" as const, excerpt: text }],
  };
}

test("procedural Knowledge queries discard conversational framing while preserving task meaning", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();

  for (const scenario of CASES) {
    const queries = deriver.derive({ objective: scenario.objective, context: [] });
    assert.ok(queries.length >= 1 && queries.length <= 2);
    assert.ok(
      queries.some((query) => scenario.required.every((pattern) => pattern.test(query))),
      `Expected a task-specific procedural query for: ${scenario.objective}`,
    );
    for (const query of queries) {
      assert.doesNotMatch(query, /\bneed\b/iu);
      assert.doesNotMatch(query, /\bfor\b/iu);
    }
  }
});

test("procedural relevance preserves ordinary word morphology without relaxing multi-term overlap", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();

  const soilObjective = "I need to know how to prepare my soil for sod.";
  const soilQueries = deriver.derive({ objective: soilObjective, context: [] });
  const tillage = source(
    "tillage",
    "Tillage",
    "Tillage is the agricultural preparation of soil by mechanical agitation such as digging, stirring, and overturning.",
  );
  assert.equal(qualifier.disposition({
    objective: soilObjective,
    context: [],
    queries: soilQueries,
    source: tillage,
    claim: claim(tillage.sourceId, tillage.content),
  }).relevant, true);

  const glazeObjective = "I need to know how to glaze a ceramic pot.";
  const glazeQueries = deriver.derive({ objective: glazeObjective, context: [] });
  const glazing = source(
    "glazing",
    "Ceramic glaze",
    "Ceramic glazing coats pottery with a vitreous layer that is applied before firing.",
  );
  assert.equal(qualifier.disposition({
    objective: glazeObjective,
    context: [],
    queries: glazeQueries,
    source: glazing,
    claim: claim(glazing.sourceId, glazing.content),
  }).relevant, true);

  const collisionObjective = "Why does cast iron rust?";
  const collisionQueries = deriver.derive({ objective: collisionObjective, context: [] });
  const collision = source(
    "castanea",
    "Castanea crenata",
    "Castanea crenata is a chestnut species whose resistance mechanism can cause a defensive response.",
  );
  assert.equal(qualifier.disposition({
    objective: collisionObjective,
    context: [],
    queries: collisionQueries,
    source: collision,
    claim: claim(collision.sourceId, collision.content),
  }).relevant, false);
});
