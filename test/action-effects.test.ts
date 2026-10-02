/**
 * DP-015 Action effect-rule boundary regressions.
 *
 * Covers the single lawful effect route: the exact-token registry (miss →
 * nothing, duplicate → fail closed, empty v1 registry), effect projection
 * (only established consequence/reversibility cross; explicit UNKNOWN and
 * unauthorized fields never do), and structured-facts-only rule inputs
 * (no prose, no model labels). All concrete rules below are clearly
 * test-local fixtures; production registers zero rules.
 *
 * Held-out note (CA-04): this boundary is deterministic and
 * domain-independent — class tokens and categorical dimensions carry no
 * domain wording — so identical structured inputs must give identical
 * outputs by construction.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { qualifyActionEffects } from "../src/action/effects/qualify-effects.js";
import { ACTION_EFFECT_REGISTRY, createActionEffectRegistry } from "../src/action/effects/registry.js";
import type {
  ActionEffectQualification,
  ActionEffectQualificationInput,
  ActionEffectRule,
} from "../src/action/effects/types.js";
import type { StructuredActionFact } from "../src/action/types.js";

function testOnlyRule(
  overrides: {
    readonly ruleId?: string;
    readonly verdict?: ActionEffectQualification;
    readonly onEvaluate?: (input: ActionEffectQualificationInput) => ActionEffectQualification;
  } = {},
): ActionEffectRule {
  return Object.freeze({
    ruleId: overrides.ruleId ?? "TEST_ONLY_EFFECT_RULE_V1",
    actionClass: "DECISION_EVIDENCE_INVESTIGATION" as const,
    evaluate(input: ActionEffectQualificationInput): ActionEffectQualification {
      if (overrides.onEvaluate !== undefined) return overrides.onEvaluate(input);
      return overrides.verdict ?? {};
    },
  });
}

test("dp015_effects_v1_registry_is_empty", () => {
  assert.equal(ACTION_EFFECT_REGISTRY.ruleFor("DECISION_EVIDENCE_INVESTIGATION"), undefined);
  assert.equal(ACTION_EFFECT_REGISTRY.ruleFor("CAPABILITY_EFFECT"), undefined);
  assert.equal(ACTION_EFFECT_REGISTRY.ruleFor(undefined), undefined);
  assert.deepEqual(
    qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] }),
    [],
  );
  assert.deepEqual(qualifyActionEffects({ actionClass: undefined, facts: [] }), []);
});

test("dp015_effects_registry_miss_emits_nothing", () => {
  const registry = createActionEffectRegistry([]);
  const supportPremise: StructuredActionFact = { source: "ACTION_SUPPORT_RULE", support: "PARTIAL" };
  assert.deepEqual(
    qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [supportPremise] }, registry),
    [],
  );
  assert.equal(registry.ruleFor("DECISION_EVIDENCE_INVESTIGATION"), undefined);
  assert.equal(registry.ruleFor(42), undefined);
});

test("dp015_effects_duplicate_ownership_fails_closed", () => {
  const first = testOnlyRule({ ruleId: "TEST_ONLY_EFFECT_A_V1" });
  const second = testOnlyRule({ ruleId: "TEST_ONLY_EFFECT_B_V1" });
  assert.throws(() => createActionEffectRegistry([first, second]), /Duplicate ActionEffectRule/);
});

test("dp015_effects_single_rule_resolves_by_exact_token", () => {
  const rule = testOnlyRule({ verdict: { consequence: "LOW" } });
  const registry = createActionEffectRegistry([rule]);
  assert.equal(registry.ruleFor("DECISION_EVIDENCE_INVESTIGATION"), rule);
  assert.equal(registry.ruleFor("decisionevidenceinvestigation"), undefined);
  assert.equal(registry.ruleFor(" DECISION_EVIDENCE_INVESTIGATION"), undefined);
});

test("dp015_effects_explicit_unknown_is_never_emitted", () => {
  const smuggled = {
    consequence: "UNKNOWN",
    reversibility: "UNKNOWN",
  } as unknown as ActionEffectQualification;
  const registry = createActionEffectRegistry([testOnlyRule({ verdict: smuggled })]);
  assert.deepEqual(
    qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] }, registry),
    [],
  );
});

test("dp015_effects_projection_carries_only_source_and_established_dimensions", () => {
  const both = createActionEffectRegistry([
    testOnlyRule({ verdict: { consequence: "MATERIAL", reversibility: "PARTIALLY_REVERSIBLE" } }),
  ]);
  const facts = qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] }, both);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], {
    source: "ACTION_EFFECT_RULE",
    consequence: "MATERIAL",
    reversibility: "PARTIALLY_REVERSIBLE",
  });
  assert.deepEqual(Object.keys(facts[0] as unknown as Record<string, unknown>).sort(), [
    "consequence",
    "reversibility",
    "source",
  ]);

  const single = createActionEffectRegistry([testOnlyRule({ verdict: { consequence: "LOW" } })]);
  const singleFacts = qualifyActionEffects(
    { actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] },
    single,
  );
  assert.equal(singleFacts.length, 1);
  assert.deepEqual(singleFacts[0], { source: "ACTION_EFFECT_RULE", consequence: "LOW" });

  const empty = createActionEffectRegistry([testOnlyRule({ verdict: {} })]);
  assert.deepEqual(
    qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] }, empty),
    [],
  );
});

test("dp015_effects_rule_verdict_never_copies_unauthorized_fields", () => {
  const smuggled = {
    consequence: "LOW",
    reversibility: "REVERSIBLE",
    support: "SUFFICIENT",
    materialBlocker: true,
    safeguardOrAuthorityEstablished: true,
    diagnosticStepAvailable: true,
    infoStepAvailable: true,
    oversightRequired: true,
  } as unknown as ActionEffectQualification;
  const registry = createActionEffectRegistry([testOnlyRule({ verdict: smuggled })]);
  const facts = qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] }, registry);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], {
    source: "ACTION_EFFECT_RULE",
    consequence: "LOW",
    reversibility: "REVERSIBLE",
  });
});

test("dp015_effects_rule_receives_only_governed_structured_facts", () => {
  let seen: ActionEffectQualificationInput | undefined;
  const registry = createActionEffectRegistry([
    testOnlyRule({
      onEvaluate: (input) => {
        seen = input;
        return {};
      },
    }),
  ]);
  const smuggled = { source: "MODEL_RISK_LABEL", consequence: "LOW" } as unknown as StructuredActionFact;
  const governed: StructuredActionFact = { source: "KNOWLEDGE_V36", support: "SUFFICIENT" };
  qualifyActionEffects(
    { actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [governed, smuggled] },
    registry,
  );
  assert.notEqual(seen, undefined);
  assert.equal(seen?.actionClass, "DECISION_EVIDENCE_INVESTIGATION");
  assert.deepEqual(seen?.facts, [governed]);
  assert.deepEqual(Object.keys(seen ?? {}).sort(), ["actionClass", "facts"]);
});

test("dp015_effects_pre_existing_effect_facts_never_feed_a_rule", () => {
  let seen: ActionEffectQualificationInput | undefined;
  const registry = createActionEffectRegistry([
    testOnlyRule({
      onEvaluate: (input) => {
        seen = input;
        return {};
      },
    }),
  ]);
  const injected = { source: "ACTION_EFFECT_RULE", consequence: "LOW" } as unknown as StructuredActionFact;
  const premise: StructuredActionFact = { source: "ACTION_SUPPORT_RULE", support: "PARTIAL" };
  qualifyActionEffects(
    { actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [injected, premise] },
    registry,
  );
  assert.notEqual(seen, undefined);
  assert.deepEqual(seen?.facts, [premise]);
});

test("dp015_effects_output_is_frozen", () => {
  const registry = createActionEffectRegistry([
    testOnlyRule({ verdict: { consequence: "HIGH", reversibility: "IRREVERSIBLE" } }),
  ]);
  const facts = qualifyActionEffects({ actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] }, registry);
  assert.ok(Object.isFrozen(facts));
  assert.ok(Object.isFrozen(facts[0]));
  const miss = qualifyActionEffects({ actionClass: undefined, facts: [] }, registry);
  assert.ok(Object.isFrozen(miss));
});

test("dp015_effects_consequence_and_reversibility_are_independent", () => {
  const consequenceOnly = createActionEffectRegistry([
    testOnlyRule({ verdict: { consequence: "HIGH" } }),
  ]);
  const facts = qualifyActionEffects(
    { actionClass: "DECISION_EVIDENCE_INVESTIGATION", facts: [] },
    consequenceOnly,
  );
  assert.equal(facts.length, 1);
  assert.equal((facts[0] as { reversibility?: unknown }).reversibility, undefined);
  assert.equal(facts[0]?.consequence, "HIGH");
});
