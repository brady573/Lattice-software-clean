import type { LatticeRun } from "../../domain.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../../outcome.js";
import {
  KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE,
  knowledgeSimplificationRequested,
  type KnowledgeSimplifier,
} from "./knowledge-simplification.js";

const EMPTY_KNOWLEDGE_MESSAGE = "No validated external findings are sufficiently relevant to this objective.";
const EMPTY_CAUSAL_KNOWLEDGE_MESSAGE = "I couldn't establish why this happens from the available evidence.";
const CAUSE_SEEKING_OBJECTIVE_PATTERN = /\b(?:why|cause|causes|caused|causing|mechanism)\b/iu;

function renderSourceReportFinding(finding: KnowledgeFinding, text = finding.text): string {
  const statusLabel: Record<KnowledgeFinding["status"], string> = {
    SUPPORTED: "Supported",
    REFUTED: "Refuted",
    CONFLICTED: "Materially conflicted",
    UNRESOLVED: "Unresolved",
  };
  return `${statusLabel[finding.status]} as a source report: ${text} This status concerns what the retrieved source material reports; it does not independently verify the broader real-world claim.`;
}

function renderFinding(finding: KnowledgeFinding, text = finding.text): string {
  if (finding.basis === "SOURCE_REPORT") return renderSourceReportFinding(finding, text);

  switch (finding.status) {
    case "SUPPORTED":
      return `Supported: ${text}`;
    case "REFUTED":
      return `Refuted: ${text}`;
    case "CONFLICTED":
      return `Material conflict remains: ${text}`;
    case "UNRESOLVED":
      return `Qualified evidence did not establish this strongly enough: ${text}`;
  }
}

/**
 * Project governed KnowledgeOutcome content into concise Solandra conversation text.
 * This function is deterministic and extractive: it does not retrieve, synthesize,
 * adjudicate, mutate, or otherwise add authority beyond the canonical outcome.
 */
export function renderKnowledgeResponse(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) {
    if (CAUSE_SEEKING_OBJECTIVE_PATTERN.test(knowledge.objective)) return EMPTY_CAUSAL_KNOWLEDGE_MESSAGE;
    return knowledge.uncertainties.find((item) => item.includes("No validated external findings"))
      ?? EMPTY_KNOWLEDGE_MESSAGE;
  }

  return knowledge.findings.map((finding) => renderFinding(finding)).join("\n\n");
}

/**
 * Apply an optional non-authoritative comprehension transform only when the
 * exact Run is a simplification follow-up. Canonical Knowledge remains intact.
 */
export async function renderKnowledgeResponseForRun(
  knowledge: KnowledgeOutcome,
  run: LatticeRun,
  simplifier?: KnowledgeSimplifier,
): Promise<string> {
  const governed = renderKnowledgeResponse(knowledge);
  if (!knowledgeSimplificationRequested(run)) return governed;

  if (knowledge.findings.length !== 1 || simplifier === undefined) {
    return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;
  }

  const finding = knowledge.findings[0];
  const simplified = await simplifier.simplify({ runId: run.id, finding });
  if (simplified === null) {
    return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;
  }
  return renderFinding(finding, simplified);
}
