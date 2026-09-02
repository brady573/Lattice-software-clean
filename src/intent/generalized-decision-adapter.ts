import type { QualifiedCriterionCatalog } from "../decision/criterion-catalog.js";
import type { GeneralizedDecisionAdapter } from "../run-execution.js";
import { deriveGeneralizedDecisionIntentFromState } from "./generalized-decision-projection.js";
import type { IntentAuthorityStore } from "./store.js";

/**
 * Wire Intent Authority's already-confirmed generic IntentState into the
 * generalized Decision Engine adapter seam. This performs no interpretation
 * of USER text: it only projects a stored, confirmed IntentVersion.
 */
export function createIntentAuthorityGeneralizedDecisionAdapter(
  intentStore: IntentAuthorityStore,
  catalog: QualifiedCriterionCatalog,
): GeneralizedDecisionAdapter {
  return {
    catalog,
    async loadIntent(request) {
      if (!request.intentScopeId || !request.intentVersionId) {
        throw new Error("Qualified consultation decision requires an authoritative Intent scope and version.");
      }
      const version = await intentStore.getVersion(request.intentVersionId);
      if (!version) {
        throw new Error(
          `Qualified consultation decision requires a confirmed IntentVersion: ${request.intentVersionId}.`,
        );
      }
      return deriveGeneralizedDecisionIntentFromState(request.intentScopeId, version.intentVersionId, version.state);
    },
  };
}
