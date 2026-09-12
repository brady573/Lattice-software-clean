import { isConsultationRunRequest, type LatticeRun } from "../../domain.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../../outcome.js";
import {
  KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE,
  knowledgeSimplificationRequested,
  type KnowledgeSimplificationAttempt,
  type KnowledgeSimplifier,
} from "./knowledge-simplification.js";

const EMPTY_KNOWLEDGE_MESSAGE = "No validated external findings are sufficiently relevant to this objective.";
const SOURCE_REQUEST_PATTERN = /\b(?:source|sources|citation|citations|evidence)\b/iu;
/*
 * Source suitability is a real trust boundary. This lexical applicability check
 * remains isolated debt until cognition can supply the applicability decision
 * without weakening authoritative-source enforcement. Do not expand this list.
 */
const HIGH_STAKES_SOURCE_PATTERN = /\b(?:tax|taxes|taxation|taxable|legal|law|laws|regulation|regulatory|regulated|compliance|license|licensing|permit|statute|statutory)\b/iu;
const SOURCE_SUITABILITY_LIMITATION =
  "I found relevant background material, but I need an appropriate authoritative source before I can answer this kind of question reliably.";
const GENERIC_INSUFFICIENT_KNOWLEDGE_MESSAGE =
  "I couldn't establish enough relevant evidence to answer that reliably.";

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
    case "SUPPORTED": return `Supported: ${text}`;
    case "REFUTED": return `Refuted: ${text}`;
    case "CONFLICTED": return `Material conflict remains: ${text}`;
    case "UNRESOLVED": return `Qualified evidence did not establish this strongly enough: ${text}`;
  }
}

function runContext(run: LatticeRun): readonly string[] {
  return isConsultationRunRequest(run.request) ? run.request.context : [];
}

function sourceRequest(context: readonly string[]): boolean {
  return SOURCE_REQUEST_PATTERN.test(context.at(-1)?.trim() ?? "");
}

function requiresAuthoritativeDomainSource(knowledge: KnowledgeOutcome): boolean {
  return HIGH_STAKES_SOURCE_PATTERN.test(knowledge.objective);
}

function hasAuthoritativeDomainSource(knowledge: KnowledgeOutcome): boolean {
  return knowledge.provenance.some((source) => source.evidentiarySuitability === "AUTHORITATIVE_DOMAIN");
}

function sourceLabel(knowledge: KnowledgeOutcome): string {
  if (knowledge.provenance.length === 0) return "";
  const labels = knowledge.provenance.slice(0, 3).map((source) => {
    const title = source.title?.trim() || source.canonicalUri;
    return source.publisher ? `${title} — ${source.publisher}` : title;
  });
  return `Sources: ${labels.join("; ")}.`;
}

function isInternalKnowledgeLimitation(item: string): boolean {
  return item.startsWith("UNRESOLVED:")
    || item.startsWith("CONFLICTED:")
    || item.startsWith("Source-report evidence establishes only what the retrieved sources report;")
    || item.startsWith("This v0.1 ");
}

function uncertaintyLabel(knowledge: KnowledgeOutcome): string {
  const uncertainties = knowledge.uncertainties.filter((item) => !isInternalKnowledgeLimitation(item));
  if (uncertainties.length === 0) return "";
  return `Known uncertainty:\n${uncertainties.map((item) => `- ${item}`).join("\n")}`;
}

function renderSourceList(knowledge: KnowledgeOutcome): string {
  if (knowledge.provenance.length === 0) return "I don't have a source to show for this answer.";
  const lines = knowledge.provenance.map((source) => {
    const title = source.title?.trim() || source.canonicalUri;
    const publisher = source.publisher ? ` — ${source.publisher}` : "";
    return `- ${title}${publisher}\n  ${source.canonicalUri}`;
  });
  const suitabilityNote = requiresAuthoritativeDomainSource(knowledge) && !hasAuthoritativeDomainSource(knowledge)
    ? "\n\nThese are useful background sources, but I have not established an appropriate authoritative source for this kind of question."
    : "";
  return `Sources I used:\n${lines.join("\n")}${suitabilityNote}`;
}

function renderGovernedAnswer(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) return GENERIC_INSUFFICIENT_KNOWLEDGE_MESSAGE;

  if (requiresAuthoritativeDomainSource(knowledge) && !hasAuthoritativeDomainSource(knowledge)) {
    return [SOURCE_SUITABILITY_LIMITATION, sourceLabel(knowledge)].filter(Boolean).join("\n\n");
  }

  const conflicted = knowledge.findings.filter((finding) => finding.status === "CONFLICTED");
  if (conflicted.length > 0) {
    return [
      `The available evidence conflicts on this point, so I can't give a single reliable answer: ${conflicted.map((finding) => finding.text).join(" ")}`,
      uncertaintyLabel(knowledge),
      sourceLabel(knowledge),
    ].filter(Boolean).join("\n\n");
  }

  const refuted = knowledge.findings.filter((finding) => finding.status === "REFUTED");
  if (refuted.length > 0) {
    return [
      `The available governed evidence refutes this claim: ${refuted.map((finding) => finding.text).join(" ")}`,
      uncertaintyLabel(knowledge),
      sourceLabel(knowledge),
    ].filter(Boolean).join("\n\n");
  }

  const answerable = knowledge.findings.filter((finding) =>
    finding.status === "SUPPORTED"
    || (finding.basis === "SOURCE_REPORT" && finding.evidenceIds.length > 0)
  );
  if (answerable.length === 0) {
    return [
      knowledge.findings.map((finding) => renderFinding(finding)).join("\n\n"),
      uncertaintyLabel(knowledge),
      sourceLabel(knowledge),
    ].filter(Boolean).join("\n\n");
  }

  const sourceReportOnly = answerable.every((finding) => finding.basis === "SOURCE_REPORT");
  const answer = sourceReportOnly
    ? `The retrieved source material reports: ${answerable.map((finding) => finding.text).join(" ")}`
    : answerable.map((finding) => finding.text).join(" ");
  const qualification = sourceReportOnly
    ? "That establishes what the cited source reports; it does not by itself independently verify the broader real-world claim."
    : "";

  return [
    answer,
    qualification,
    uncertaintyLabel(knowledge),
    sourceLabel(knowledge),
  ].filter(Boolean).join("\n\n");
}

function simplificationLimitation(attempt: KnowledgeSimplificationAttempt): string {
  switch (attempt.status) {
    case "CAPABILITY_NOT_AUTHORIZED":
      return "Model assistance isn't connected. Connect it in Solandra if you want me to simplify this wording.";
    case "CAPABILITY_UNAVAILABLE":
      return "Model assistance isn't available in this Lattice setup, so I kept the original wording.";
    case "CAPABILITY_REVOKED":
      return "Model assistance was disconnected before that result could be used, so I kept the original wording.";
    case "PROVIDER_FAILURE":
      return "Model assistance couldn't complete that request, so I kept the original wording.";
    case "FIDELITY_REJECTED":
      return KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE;
    case "SIMPLIFIED":
      return "";
  }
}

async function attemptSimplification(
  simplifier: KnowledgeSimplifier,
  runId: string,
  finding: KnowledgeFinding,
): Promise<KnowledgeSimplificationAttempt> {
  if (simplifier.simplifyWithAudit !== undefined) {
    return await simplifier.simplifyWithAudit({ runId, finding });
  }
  const text = await simplifier.simplify({ runId, finding });
  return text === null
    ? Object.freeze({ status: "FIDELITY_REJECTED", text: null, invocationProvenance: null })
    : Object.freeze({ status: "SIMPLIFIED", text, invocationProvenance: null });
}

/** Project governed KnowledgeOutcome content into concise Solandra conversation text. */
export function renderKnowledgeResponse(knowledge: KnowledgeOutcome): string {
  if (knowledge.findings.length === 0) {
    return knowledge.uncertainties.find((item) => item.includes("No validated external findings"))
      ?? EMPTY_KNOWLEDGE_MESSAGE;
  }
  return knowledge.findings.map((finding) => renderFinding(finding)).join("\n\n");
}

/**
 * Produce Product-facing Knowledge without changing canonical Knowledge. Direct
 * answers render governed findings structurally rather than reconstructing their
 * meaning from lexical markers. Explicit legacy model assistance remains bounded
 * to its existing subject-authorized simplification capability.
 */
export async function renderKnowledgeResponseForRun(
  knowledge: KnowledgeOutcome,
  run: LatticeRun,
  simplifier?: KnowledgeSimplifier,
): Promise<string> {
  const context = runContext(run);
  if (sourceRequest(context)) return renderSourceList(knowledge);

  if (requiresAuthoritativeDomainSource(knowledge) && !hasAuthoritativeDomainSource(knowledge)) {
    return [SOURCE_SUITABILITY_LIMITATION, sourceLabel(knowledge)].filter(Boolean).join("\n\n");
  }

  const governed = renderKnowledgeResponse(knowledge);
  if (!knowledgeSimplificationRequested(run)) return renderGovernedAnswer(knowledge);

  if (knowledge.findings.length !== 1 || simplifier === undefined) {
    return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;
  }

  const finding = knowledge.findings[0];
  if (finding === undefined) return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;

  const attempt = await attemptSimplification(simplifier, run.id, finding);
  if (attempt.status !== "SIMPLIFIED") {
    return `${governed}\n\n${simplificationLimitation(attempt)}`;
  }
  return renderFinding(finding, attempt.text);
}
