/**
 * DP-015 Action effect-rule registry.
 *
 * Governed class → approved rule mapping. Exact-token lookup only; the
 * registry never inspects prose, model output, keywords, or similarity.
 * A miss yields `undefined` and the caller emits nothing (UNKNOWN by
 * absence). Registering a second rule for the same class fails closed at
 * construction.
 *
 * DP-015 v1 registers zero concrete rules — including none for
 * DECISION_EVIDENCE_INVESTIGATION, which stays UNKNOWN/UNKNOWN.
 *
 * Pure, deterministic, dependency-free beyond sibling types. No model call,
 * no persistence, no F8 emission.
 */

import type { QualifiedActionClass } from "../types.js";
import type { ActionEffectRule } from "./types.js";

/** Exact class-token → approved-rule lookup. */
export interface ActionEffectRegistry {
  ruleFor(actionClass: unknown): ActionEffectRule | undefined;
}

/**
 * Build a governed registry from approved rules. Throws on a second rule
 * for the same class (duplicate ownership fails closed); the returned
 * registry is frozen.
 */
export function createActionEffectRegistry(
  rules: readonly ActionEffectRule[],
): ActionEffectRegistry {
  const table = new Map<string, ActionEffectRule>();
  for (const rule of rules) {
    if (table.has(rule.actionClass)) {
      throw new Error(
        `Duplicate ActionEffectRule for action class "${rule.actionClass}" (rule "${rule.ruleId}").`,
      );
    }
    table.set(rule.actionClass, rule);
  }
  const registry: ActionEffectRegistry = {
    ruleFor(actionClass: unknown): ActionEffectRule | undefined {
      if (typeof actionClass !== "string") return undefined;
      return table.get(actionClass);
    },
  };
  return Object.freeze(registry);
}

/** The DP-015 v1 governed registry: empty. Zero rules is correct. */
export const ACTION_EFFECT_REGISTRY: ActionEffectRegistry = createActionEffectRegistry([]);
