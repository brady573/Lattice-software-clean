/**
 * DP-015 effect-fact qualification.
 *
 * Runs the approved ActionEffectRule for an established governed class and
 * returns zero or more frozen governed facts for the shared F4 `evaluate()`
 * pipeline. A registry miss (unknown class, no class, unruled class —
 * including DECISION_EVIDENCE_INVESTIGATION in v1) emits nothing — UNKNOWN
 * by absence, never an explicit UNKNOWN fact.
 *
 * Authority: the single emitted fact (when any dimension is established)
 * carries source ACTION_EFFECT_RULE with ONLY consequence/reversibility.
 * It never copies support, flags, prose, or model labels, and never emits
 * explicit UNKNOWN. It does NOT select a mode.
 *
 * Pure, deterministic, dependency-free beyond siblings. No model call, no
 * persistence, no F8 emission.
 */

import type { StructuredActionFact } from "../types.js";
import type { QualifiedActionClass } from "../types.js";
import { ACTION_EFFECT_REGISTRY, type ActionEffectRegistry } from "./registry.js";

/** The fixed 8-member source allowlist; rules see governed premises only. */
const PERMITTED_SOURCES: ReadonlySet<string> = new Set<string>([
  "CANDIDATE_PROPOSAL",
  "F6_CALIBRATED_SIGNAL",
  "INTENT_AUTHORITY",
  "KNOWLEDGE_V36",
  "DECISION_ENGINE_RESULT",
  "CAPABILITY_EFFECT",
  "ACTION_SUPPORT_RULE",
  "ACTION_EFFECT_RULE",
]);

/** Established values a rule verdict may project. Anything else is ignored. */
const KNOWN_CONSEQUENCE: ReadonlySet<string> = new Set<string>([
  "LOW",
  "MATERIAL",
  "HIGH",
]);

const KNOWN_REVERSIBILITY: ReadonlySet<string> = new Set<string>([
  "REVERSIBLE",
  "PARTIALLY_REVERSIBLE",
  "IRREVERSIBLE",
]);

/** Empty frozen result shared by miss/empty paths. */
const NO_FACTS: readonly StructuredActionFact[] = Object.freeze([]);

/** Input: the candidate's already-governed class plus structured facts. */
export interface QualifyActionEffectsInput {
  readonly actionClass: QualifiedActionClass | undefined;
  readonly facts: readonly StructuredActionFact[];
}

function isPermittedFact(fact: StructuredActionFact): boolean {
  if (fact === null || typeof fact !== "object") return false;
  const source: unknown = (fact as { source?: unknown }).source;
  return typeof source === "string" && PERMITTED_SOURCES.has(source);
}

/**
 * Evaluate the exact registry match (default: the governed v1 registry)
 * and project only present, valid, non-UNKNOWN dimensions into a single
 * frozen ACTION_EFFECT_RULE fact. Miss, empty verdict, or fully invalid
 * verdict yields the empty frozen set.
 */
export function qualifyActionEffects(
  input: QualifyActionEffectsInput,
  registry: ActionEffectRegistry = ACTION_EFFECT_REGISTRY,
): readonly StructuredActionFact[] {
  if (input.actionClass === undefined) return NO_FACTS;
  const rule = registry.ruleFor(input.actionClass);
  if (rule === undefined) return NO_FACTS;
  const governed = input.facts.filter(isPermittedFact);
  const verdict = rule.evaluate({ actionClass: input.actionClass, facts: governed });
  const consequence = verdict.consequence !== undefined && KNOWN_CONSEQUENCE.has(verdict.consequence)
    ? verdict.consequence
    : undefined;
  const reversibility = verdict.reversibility !== undefined && KNOWN_REVERSIBILITY.has(verdict.reversibility)
    ? verdict.reversibility
    : undefined;
  if (consequence === undefined && reversibility === undefined) return NO_FACTS;
  return Object.freeze([
    Object.freeze({
      source: "ACTION_EFFECT_RULE" as const,
      ...(consequence !== undefined ? { consequence } : {}),
      ...(reversibility !== undefined ? { reversibility } : {}),
    }),
  ]);
}
