import { runRequestSchema, type RunRequest } from "../../src/domain.js";
import { intentStateSchema, type IntentState } from "../../src/intent/types.js";

const BOUNDED_OBJECTIVE_PATTERN = /^choose (?:a|an) [a-z0-9][a-z0-9 .+'/_-]{0,120}$/i;

function readValue(
  state: IntentState,
  kind: "OBJECTIVE" | "REQUIREMENT" | "PREFERENCE",
  key?: string,
): string | number | boolean | undefined {
  const field = kind === "OBJECTIVE"
    ? state.objective
    : kind === "REQUIREMENT"
      ? state.requirements[key ?? ""]
      : state.preferences[key ?? ""];
  return field?.value.state === "VALUE" ? field.value.value : undefined;
}

function sentenceCase(value: string): string {
  const normalized = value.trim();
  return normalized.length === 0
    ? normalized
    : `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
}

/**
 * Reconstructs the already-qualified bounded price/battery/performance planning
 * contract without coupling the objective to a specific decision target.
 *
 * This is deliberately not a generalized Decision Engine adapter: it does not
 * invent OD-003 priority tiers, criterion versions, tolerances, or delegation.
 * Unsupported IntentVersions fail closed until a separately qualified planner
 * can project their authoritative semantics.
 */
export function deriveQualifiedLegacyBoundedRunRequest(stateInput: IntentState): RunRequest {
  const state = intentStateSchema.parse(stateInput);
  const objectiveValue = readValue(state, "OBJECTIVE");
  const priceMaxUsd = readValue(state, "REQUIREMENT", "price.max.usd");
  const batteryHours = readValue(state, "REQUIREMENT", "batteryHours.min");
  const performanceRelation = readValue(state, "PREFERENCE", "performance.relativeToBattery");
  const objective = typeof objectiveValue === "string" ? objectiveValue.trim() : "";

  if (
    !BOUNDED_OBJECTIVE_PATTERN.test(objective)
    || typeof priceMaxUsd !== "number"
    || typeof batteryHours !== "number"
    || performanceRelation !== "MORE_IMPORTANT"
  ) {
    throw new Error(
      "Exact IntentVersion has no qualified planner projection for legacy RunRequest material.",
    );
  }

  return {
    goal: `${sentenceCase(objective)} under $${priceMaxUsd} with at least ${batteryHours} hours of battery life, prioritizing performance.`,
    priorities: [{ criterion: "performance", weight: 1 }],
    hardConstraints: [
      { criterion: "price", operator: "lte", value: priceMaxUsd },
      { criterion: "batteryHours", operator: "gte", value: batteryHours },
    ],
  };
}

export function assertPlanningMaterialFaithfulToExactIntent(
  stateInput: IntentState,
  planningMaterialInput: unknown,
): void {
  const expected = deriveQualifiedLegacyBoundedRunRequest(stateInput);
  const planningMaterial = runRequestSchema.parse(planningMaterialInput);
  if (JSON.stringify(planningMaterial) !== JSON.stringify(expected)) {
    throw new Error(
      "DecisionPlan planning material is not the qualified projection of its exact IntentVersion.",
    );
  }
}
