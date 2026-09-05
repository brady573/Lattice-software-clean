import type { KnowledgeFinding, KnowledgeOutcome } from "../../outcome.js";

const EMPTY_KNOWLEDGE_MESSAGE = "No validated external findings are sufficiently relevant to this objective.";

function renderFinding(finding: KnowledgeFinding): string {
  switch (finding.status) {
    case "SUPPORTED":
      return `Supported: ${finding.text}`;
    case "REFUTED":
      return `Refuted: ${finding.text}`;
    case "CONFLICTED":
      return `Material conflict remains: ${finding.text}`;
    case "UNRESOLVED":
      if (finding.basis === "SOURCE_REPORT") {
        return `Retrieved sources report: ${finding.text} This remains unresolved beyond the source report and is not independent verification.`;
      }
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
    return knowledge.uncertainties.find((item) => item.includes("No validated external findings"))
      ?? EMPTY_KNOWLEDGE_MESSAGE;
  }

  return knowledge.findings.map(renderFinding).join("\n\n");
}
