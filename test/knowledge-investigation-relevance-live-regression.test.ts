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

test("single-subject relational questions require subject-to-mechanism linkage", () => {
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

  const relationOnly = source(
    "relation-only",
    "Compass",
    "A compass shows cardinal directions used for navigation and geographic orientation, including south.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: relationOnly,
    claim: claim(relationOnly.sourceId, relationOnly.content),
  }).relevant, false);

  const linked = source(
    "linked",
    "Duck navigation",
    "A duck can use environmental navigation and orientation cues to determine direction during movement.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: linked,
    claim: claim(linked.sourceId, linked.content),
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

test("derived concepts cannot rescue a one-term collision for a multi-specific objective", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const objective = "Why does cast iron rust?";
  const queries = deriver.derive({ objective, context: [] });

  const lexicalCollision = source(
    "castanea",
    "Castanea crenata",
    "Castanea crenata is a chestnut species. Its resistance mechanism may involve a gene that causes a defensive response.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: lexicalCollision,
    claim: claim(lexicalCollision.sourceId, lexicalCollision.content),
  }).relevant, false);

  const relevantRust = source(
    "rust",
    "Rust",
    "Rust forms when iron reacts with oxygen in the presence of water or air moisture.",
  );
  assert.equal(qualifier.disposition({
    objective,
    context: [],
    queries,
    source: relevantRust,
    claim: claim(relevantRust.sourceId, relevantRust.content),
  }).relevant, true);
});
