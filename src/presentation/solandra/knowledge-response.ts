import { isConsultationRunRequest, type LatticeRun } from "../../domain.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../../outcome.js";
import {
  KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE,
  knowledgeSimplificationRequested,
  type KnowledgeSimplifier,
} from "./knowledge-simplification.js";

const EMPTY_KNOWLEDGE_MESSAGE = "No validated external findings are sufficiently relevant to this objective.";
const EMPTY_CAUSAL_KNOWLEDGE_MESSAGE = "I couldn't establish why this happens from the available evidence.";
const CAUSE_SEEKING_OBJECTIVE_PATTERN = /\b(?:why|cause|causes|caused|causing|mechanism)\b/iu;
const CAUSE_SEEKING_FOLLOW_UP_PATTERN = /^(?:why\??|explain(?:\s+that)?(?:\s+more)?|tell\s+me\s+more)\.?$/iu;
const DIRECT_CAUSAL_SENTENCE_PATTERN = /\b(?:because|due\s+to|cause|causes|caused|causing|lead|leads|led|leading|result|results|resulted|resulting|require|requires|required|requiring|react|reacts|reacted|reacting|trigger|triggers|triggered|triggering|produce|produces|produced|producing|drive|drives|drove|driven|driving)\b/iu;
const SOURCE_REQUEST_PATTERN = /\b(?:source|sources|citation|citations|evidence)\b/iu;
const HIGH_STAKES_SOURCE_PATTERN = /\b(?:tax|taxes|taxation|taxable|legal|law|laws|regulation|regulatory|regulated|compliance|license|licensing|permit|statute|statutory)\b/iu;
const SOURCE_SUITABILITY_LIMITATION =
  "I found relevant background material, but I need an appropriate authoritative source before I can answer this kind of question reliably.";

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

function runContext(run: LatticeRun): readonly string[] {
  return isConsultationRunRequest(run.request) ? run.request.context : [];
}

function causeSeeking(knowledge: KnowledgeOutcome, context: readonly string[]): boolean {
  return CAUSE_SEEKING_OBJECTIVE_PATTERN.test(knowledge.objective)
    || CAUSE_SEEKING_FOLLOW_UP_PATTERN.test(context.at(-1)?.trim() ?? "");
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

function faithfulSentences(value: string): string[] {
  return value
    .match(/[^.!?\n]+(?:[.!?]+|$)/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean)
    ?? [];
}

function directFragment(finding: KnowledgeFinding, causal: boolean): string | undefined {
  const sentences = faithfulSentences(finding.text);
  if (sentences.length === 0) return undefined;
  if (!causal) return sentences[0];
  return sentences.find((sentence) => DIRECT_CAUSAL_SENTENCE_PATTERN.test(sentence));
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

function renderGovernedAnswer(knowledge: KnowledgeOutcome, context: readonly string[]): string {
  if (knowledge.findings.length === 0) {
    return causeSeeking(knowledge, context)
      ? EMPTY_CAUSAL_KNOWLEDGE_MESSAGE
      : "I couldn't establish enough relevant evidence to answer that reliably.";
  }

  const conflicted = knowledge.findings.filter((finding) => finding.status === "CONFLICTED");
  if (conflicted.length > 0) {
    const disputed = directFragment(conflicted[0]!, false) ?? conflicted[0]!.text;
    return [
      `The available evidence conflicts on this point, so I can't give a single reliable answer: ${disputed}`,
      sourceLabel(knowledge),
    ].filter(Boolean).join("\n\n");
  }

  if (requiresAuthoritativeDomainSource(knowledge) && !hasAuthoritativeDomainSource(knowledge)) {
    return [SOURCE_SUITABILITY_LIMITATION, sourceLabel(knowledge)].filter(Boolean).join("\n\n");
  }

  const refuted = knowledge.findings.find((finding) => finding.status === "REFUTED");
  if (refuted) {
    const text = directFragment(refuted, false) ?? refuted.text;
    return [
      `The available governed evidence refutes this claim: ${text}`,
      sourceLabel(knowledge),
    ].filter(Boolean).join("\n\n");
  }

  const causal = causeSeeking(knowledge, context);
  const answerable = knowledge.findings.filter((finding) =>
    finding.status === "SUPPORTED"
    || (finding.basis === "SOURCE_REPORT" && finding.evidenceIds.length > 0)
  );
  const fragments = answerable
    .map((finding) => directFragment(finding, causal))
    .filter((fragment): fragment is string => fragment !== undefined)
    .filter((fragment, index, values) => values.indexOf(fragment) === index)
    .slice(0, 2);

  if (fragments.length === 0) {
    return [
      causal
        ? "I found relevant evidence, but it doesn't contain a direct explanation I can present faithfully."
        : "I found relevant evidence, but I can't turn it into a direct answer without adding unsupported meaning.",
      sourceLabel(knowledge),
    ].filter(Boolean).join("\n\n");
  }

  const sourceReportOnly = answerable.length > 0 && answerable.every((finding) => finding.basis === "SOURCE_REPORT");
  const answer = sourceReportOnly
    ? `The retrieved source material reports: ${fragments.join(" ")}`
    : fragments.join(" ");
  const qualification = sourceReportOnly
    ? "That establishes what the cited source reports; it does not by itself independently verify the broader real-world claim."
    : "";

  return [answer, qualification, sourceLabel(knowledge)].filter(Boolean).join("\n\n");
}

/**
 * Project governed KnowledgeOutcome content into concise Solandra conversation text.
 * This compatibility renderer is deterministic and extractive; canonical runtime
 * responses use renderKnowledgeResponseForRun so current-turn context can be honored.
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
 * Produce the Product-facing Knowledge response without changing canonical Knowledge.
 * Direct answers are extractive: only verbatim sentences from governed findings may
 * carry factual content. Source suitability, conflict, and insufficient fidelity fail closed.
 * PR #15 simplification remains a separate optional non-authoritative transform.
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
  if (!knowledgeSimplificationRequested(run)) return renderGovernedAnswer(knowledge, context);

  if (knowledge.findings.length !== 1 || simplifier === undefined) {
    return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;
  }

  const finding = knowledge.findings[0];
  if (finding === undefined) {
    return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;
  }
  const simplified = await simplifier.simplify({ runId: run.id, finding });
  if (simplified === null) {
    return `${governed}\n\n${KNOWLEDGE_SIMPLIFICATION_FAILURE_MESSAGE}`;
  }
  return renderFinding(finding, simplified);
}
