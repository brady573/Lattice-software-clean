import assert from "node:assert/strict";
import test from "node:test";
import {
  DeterministicKnowledgeInvestigationQueryDeriver,
  ObjectiveKnowledgeRelevanceQualifier,
} from "../src/knowledge/investigation.js";

const fixedTime = "2026-09-04T20:00:00.000Z";

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

test("single-subject relational questions diversify retrieval and reject topic-only material", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const objective = "How does a duck know what direction south is?";
  const queries = deriver.derive({ objective, context: [] });

  assert.ok(queries.some((query) => /duck/iu.test(query) && /navigation|orientation/iu.test(query)));
  assert.ok(queries.some((query) => !/duck/iu.test(query) && /navigation|orientation/iu.test(query)));

  const topicOnly = source(
    "topic-only",
    "Muscovy duck",
    "The Muscovy duck is a species of duck native to the Americas, from Mexico south to Argentina and Uruguay.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: topicOnly,
    claim: claim(topicOnly.sourceId, topicOnly.content),
  }).relevant, false);

  const mechanism = source(
    "mechanism",
    "Animal navigation",
    "Navigation and orientation can use environmental cues to determine direction during movement.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: mechanism,
    claim: claim(mechanism.sourceId, mechanism.content),
  }).relevant, true);
});

test("multi-term objectives still admit subject-specific material without requiring generated concept words", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const objective = "Why can database indexes make writes slower?";
  const queries = deriver.derive({ objective, context: [] });

  const topicOnly = source(
    "database-only",
    "Database",
    "A database is an organized collection of data stored and accessed electronically.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: topicOnly,
    claim: claim(topicOnly.sourceId, topicOnly.content),
  }).relevant, false);

  const relevant = source(
    "index-write",
    "Database index",
    "Database indexes require additional maintenance during writes, which can slow updates.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: relevant,
    claim: claim(relevant.sourceId, relevant.content),
  }).relevant, true);
});
