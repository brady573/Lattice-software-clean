import type { KnowledgeFinding, KnowledgeOutcome } from "../../outcome.js";

const EMPTY_KNOWLEDGE_MESSAGE = "No validated external findings are sufficiently relevant to this objective.";
const EMPTY_CAUSAL_KNOWLEDGE_MESSAGE = "I couldn't establish why this happens from the available evidence.";
const CAUSE_SEEKING_OBJECTIVE_PATTERN = /\b(?:why|cause|causes|caused|causing|mechanism)\b/iu;

function renderSourceReportFinding(finding: KnowledgeFinding): string {
  const statusLabel: Record<KnowledgeFinding["status"], string> = {
    SUPPORTED: "Supported",
    REFUTED: "Refuted",
    CONFLICTED: "Materially conflicted",
    UNRESOLVED: "Unresolved",
  };
  return `${statusLabel[finding.status]} as a source report: ${finding.text} This status concerns what the retrieved source material reports; it does not independently verify the broader real-world claim.`;
}

function renderFinding(finding: KnowledgeFinding): string {
  if (finding.basis === "SOURCE_REPORT") return renderSourceReportFinding(finding);

  switch (finding.status) {
    case "SUPPORTED":
      return `Supported: ${finding.text}`;
    case "REFUTED":
      return `Refuted: ${finding.text}`;
    case "CONFLICTED":
      return `Material conflict remains: ${finding.text}`;
    case "UNRESOLVED":
      return `Qualified evidence did not establish this strongly enough: ${finding.text}`;
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

  return knowledge.findings.map(renderFinding).join("\n\n");
}
