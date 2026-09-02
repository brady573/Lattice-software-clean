import { createHash } from "node:crypto";
import type { IntentOperation, IntentState } from "./types.js";

export type ConsultationDecisionNeed = "NONE" | "UNRESOLVED" | "QUALIFIED";
export type ConsultationResourceNeed = "NONE" | "CHECKLIST" | "PREPARED_MESSAGE";

export interface ConsultationInterpretationInput {
  message: string;
  context: readonly string[];
  prepare?: "CHECKLIST" | "PREPARED_MESSAGE";
  currentIntentState: IntentState | null;
}

export interface ConsultationInterpretationProposal {
  explicitOperations: IntentOperation[];
  inferredMaterialOperations: IntentOperation[];
  resourceNeed: ConsultationResourceNeed;
  possibleDecision: boolean;
  assumptions: string[];
  clarification: string | null;
}

export interface ConsultationInterpreter {
  propose(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal> | ConsultationInterpretationProposal;
}

function semanticKey(prefix: string, value: string): string {
  return `${prefix}.${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

function setRequirement(key: string, value: string | number | boolean): IntentOperation {
  return { op: "SET", path: { kind: "REQUIREMENT", key }, value: { state: "VALUE", value } };
}

function setPreference(key: string, value: string | number | boolean): IntentOperation {
  return { op: "SET", path: { kind: "PREFERENCE", key }, value: { state: "VALUE", value } };
}

function cleanCriterion(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 120);
}

function splitSentences(message: string): string[] {
  return message.split(/[.;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function parseAlternatives(message: string): string[] {
  const patterns = [
    /\bbetween\s+([^,.!?]+?)\s+and\s+([^,.!?]+?)(?=$|[,.!?])/i,
    /\bchoose\s+([^,.!?]+?)\s+or\s+([^,.!?]+?)(?=$|[,.!?])/i,
    /\b([^,.!?]+?)\s+vs\.?\s+([^,.!?]+?)(?=$|[,.!?])/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const values = [match[1], match[2]].flatMap((value) => value ? [value.trim()] : []);
    if (values.length === 2 && values[0] !== values[1]) return values;
  }
  return [];
}

function resourceNeed(message: string, explicit?: ConsultationResourceNeed): ConsultationResourceNeed {
  if (explicit && explicit !== "NONE") return explicit;
  if (/\b(checklist|to-do list|todo list|steps to follow)\b/i.test(message)) return "CHECKLIST";
  if (/\b(draft|prepared message|write (?:a |an )?(?:message|email)|message I can send|email I can send)\b/i.test(message)) return "PREPARED_MESSAGE";
  return "NONE";
}

function explicitObjective(message: string, current: IntentState | null): IntentOperation[] {
  const correction = message.match(/^\s*(?:actually|correction:|i meant)\s*[:,]?\s*(.+)$/i);
  if (correction?.[1]) {
    return [{ op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: correction[1].trim() } }];
  }
  if (!current?.objective) {
    return [{ op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: message.trim() } }];
  }
  return [];
}

function parseConditions(message: string, context: readonly string[]): IntentOperation[] {
  const operations = context.map((value) => setRequirement(semanticKey("consultation.condition", value), value.trim()));
  for (const sentence of splitSentences(message)) {
    const requirement = sentence.match(/\b(?:must|need to|has to|required to)\s+(.+)$/i);
    if (requirement?.[1]) {
      const value = requirement[1].trim();
      operations.push(setRequirement(semanticKey("consultation.requirement", value), value));
    }
    const preference = sentence.match(/\b(?:i\s+prefer|we\s+prefer|would prefer|ideally)\s+(.+)$/i);
    if (preference?.[1]) {
      const value = preference[1].trim();
      operations.push(setPreference(semanticKey("consultation.preference", value), value));
    }
  }
  return operations;
}

function parseDecisionSemantics(message: string): { explicit: IntentOperation[]; inferred: IntentOperation[]; possible: boolean } {
  const explicit: IntentOperation[] = [];
  const inferred: IntentOperation[] = [];
  const possible = /\b(?:choose|decide|pick|select|recommend|compare|best|versus|vs\.)\b/i.test(message);

  for (const label of parseAlternatives(message)) {
    explicit.push(setRequirement(semanticKey("decision.alternative", label), label));
  }

  for (const sentence of splitSentences(message)) {
    const priority = sentence.match(/^(.{1,80}?)\s+(matters most|is most important|is important|matters|is nice to have)$/i);
    if (priority?.[1] && priority[2]) {
      const criterionId = cleanCriterion(priority[1].replace(/^(?:maybe|probably|perhaps|i guess)\s+/i, ""));
      if (!criterionId) continue;
      const phrase = priority[2].toLowerCase();
      const tier = phrase.includes("most") ? "MATTERS_MOST" : phrase.includes("nice") ? "NICE_TO_HAVE" : "IMPORTANT";
      const operation = setPreference(`decision.priority.${criterionId}`, tier);
      if (/^(?:maybe|probably|perhaps|i guess)\b/i.test(sentence)) inferred.push(operation);
      else explicit.push(operation);
    }

    const hard = sentence.match(/^(.{1,80}?)\s+(?:must be|has to be|needs to be)\s+(at least|at most|no more than|exactly)\s+(-?\d+(?:\.\d+)?)$/i);
    if (hard?.[1] && hard[2] && hard[3]) {
      const criterionId = cleanCriterion(hard[1]);
      const operator = hard[2].toLowerCase() === "at least" ? "GTE" : hard[2].toLowerCase() === "exactly" ? "EQ" : "LTE";
      explicit.push(setRequirement(`decision.hard.${criterionId}.${operator}`, Number(hard[3])));
    }
  }
  return { explicit, inferred, possible };
}

export function deriveDecisionNeed(state: IntentState, possibleDecision: boolean): ConsultationDecisionNeed {
  const alternatives = Object.keys(state.requirements).filter((key) => key.startsWith("decision.alternative."));
  const priorities = Object.keys(state.preferences).filter((key) => key.startsWith("decision.priority."));
  const hardRequirements = Object.keys(state.requirements).filter((key) => key.startsWith("decision.hard."));
  if (!possibleDecision && alternatives.length < 2) return "NONE";
  if (alternatives.length >= 2 && priorities.length + hardRequirements.length > 0) return "QUALIFIED";
  return "UNRESOLVED";
}

export function clarificationForDecision(state: IntentState, possibleDecision: boolean): string | null {
  if (!possibleDecision) return null;
  const alternatives = Object.keys(state.requirements).filter((key) => key.startsWith("decision.alternative."));
  const criteria = [
    ...Object.keys(state.preferences).filter((key) => key.startsWith("decision.priority.")),
    ...Object.keys(state.requirements).filter((key) => key.startsWith("decision.hard.")),
  ];
  if (alternatives.length < 2) return "Which alternatives are you deciding between?";
  if (criteria.length === 0) return "What criterion or requirement should govern this choice?";
  return null;
}

/** Conservative deterministic interpreter used until a model interpreter is supplied. */
export class ConservativeConsultationInterpreter implements ConsultationInterpreter {
  propose(input: ConsultationInterpretationInput): ConsultationInterpretationProposal {
    const decision = parseDecisionSemantics(input.message);
    return {
      explicitOperations: [
        ...explicitObjective(input.message, input.currentIntentState),
        ...parseConditions(input.message, input.context),
        ...decision.explicit,
      ],
      inferredMaterialOperations: decision.inferred,
      resourceNeed: resourceNeed(input.message, input.prepare),
      possibleDecision: decision.possible || decision.explicit.some((operation) => operation.path.kind !== "OBJECTIVE" && "key" in operation.path && operation.path.key.startsWith("decision.")),
      assumptions: [],
      clarification: null,
    };
  }
}

export function isBroadConfirmation(message: string): boolean {
  return /^(?:yes|yes[, ]+that(?:'s| is) right|correct|confirm|confirmed)$/i.test(message.trim());
}
