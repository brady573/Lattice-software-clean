/**
 * Assumption Guard module (DP-002/DP-004): REQUIRED Confidence-stage gate
 * before any Action Engine consumption. Ephemeral and turn-scoped.
 */
export * from "./types.js";
export { guardAssumptions, isMaterialAssumption, REMAINING_UNCERTAINTY_HEADER } from "./guard.js";
export {
  guardAdvisoryConclusion,
  type AdvisoryAssumptionScreening,
  type AdvisoryAssumptionScreeningInput,
} from "./hook.js";
