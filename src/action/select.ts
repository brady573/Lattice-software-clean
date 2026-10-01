/**
 * F4 deterministic mode selection (DP-010/DP-012).
 *
 * Top-down precedence over qualified categorical states — first match wins.
 * Missing material input fails toward the less-consequential mode; ties
 * prefer the more reversible/diagnostic/information-producing move. No
 * model call, no numbers, no prose parsing. ESCALATE means external
 * expertise/oversight is required. Pure, deterministic, dependency-free.
 */

import type { ModeSelection, ModeSelectionInput } from "./types.js";

function freeze(selection: ModeSelection): ModeSelection {
  return Object.freeze(selection);
}

/**
 * Locked precedence (first match wins):
 * (1) material blocker → INVESTIGATE when an information step exists, else WAIT;
 * (2) oversight required → ESCALATE;
 * (3) INSUFFICIENT/UNKNOWN support → INVESTIGATE when an information step exists, else WAIT;
 * (4) PARTIAL support → TEST when a diagnostic step exists AND reversibility is
 *     REVERSIBLE/PARTIALLY_REVERSIBLE, else INVESTIGATE/WAIT on the info step;
 * (5) SUFFICIENT support → ACT unless vetoed (WEAKEN_AND_ASK with material
 *     affectsAction, or HIGH/IRREVERSIBLE without established safeguard or
 *     authority), in which case INVESTIGATE/WAIT on the info step;
 * (6) default WAIT. Reasons are fixed templates over categorical state names only.
 */
export function selectMode(input: ModeSelectionInput): ModeSelection {
  const qualification = input.qualification;
  const calibration = input.calibration;

  if (qualification.materialBlockerPresent) {
    return freeze(
      input.infoStepAvailable
        ? { mode: "INVESTIGATE", reason: "INVESTIGATE: MATERIAL_BLOCKER_UNRESOLVED with INFO_STEP_AVAILABLE" }
        : { mode: "WAIT", reason: "WAIT: MATERIAL_BLOCKER_UNRESOLVED with no INFO_STEP_AVAILABLE" },
    );
  }

  if (input.oversightRequired) {
    return freeze({
      mode: "ESCALATE",
      reason: "ESCALATE: OVERSIGHT_REQUIRED with external expertise",
    });
  }

  if (qualification.support === "INSUFFICIENT" || qualification.support === "UNKNOWN") {
    return freeze(
      input.infoStepAvailable
        ? { mode: "INVESTIGATE", reason: `INVESTIGATE: SUPPORT_${qualification.support} with INFO_STEP_AVAILABLE` }
        : { mode: "WAIT", reason: `WAIT: SUPPORT_${qualification.support} with no INFO_STEP_AVAILABLE` },
    );
  }

  if (qualification.support === "PARTIAL") {
    if (
      input.diagnosticStepAvailable
      && (qualification.reversibility === "REVERSIBLE"
        || qualification.reversibility === "PARTIALLY_REVERSIBLE")
    ) {
      return freeze({
        mode: "TEST",
        reason: `TEST: SUPPORT_PARTIAL with DIAGNOSTIC_STEP_AVAILABLE and REVERSIBILITY_${qualification.reversibility}`,
      });
    }
    return freeze(
      input.infoStepAvailable
        ? { mode: "INVESTIGATE", reason: "INVESTIGATE: SUPPORT_PARTIAL with INFO_STEP_AVAILABLE" }
        : { mode: "WAIT", reason: "WAIT: SUPPORT_PARTIAL with no INFO_STEP_AVAILABLE" },
    );
  }

  const calibrationVeto
    = calibration.resolution === "WEAKEN_AND_ASK" && calibration.materialAffectsAction;
  const safeguardVeto
    = (qualification.consequence === "HIGH" || qualification.reversibility === "IRREVERSIBLE")
    && !qualification.safeguardOrAuthorityEstablished;
  if (calibrationVeto || safeguardVeto) {
    const token = calibrationVeto
      ? "WEAKEN_AND_ASK with MATERIAL_AFFECTS_ACTION"
      : "SAFEGUARD_OR_AUTHORITY_MISSING";
    return freeze(
      input.infoStepAvailable
        ? { mode: "INVESTIGATE", reason: `INVESTIGATE: ${token} with INFO_STEP_AVAILABLE` }
        : { mode: "WAIT", reason: `WAIT: ${token} with no INFO_STEP_AVAILABLE` },
    );
  }

  if (qualification.support === "SUFFICIENT") {
    return freeze({
      mode: "ACT",
      reason: `ACT: SUPPORT_SUFFICIENT with CONSEQUENCE_${qualification.consequence} and REVERSIBILITY_${qualification.reversibility}`,
    });
  }

  return freeze({ mode: "WAIT", reason: "WAIT: no selection rule matched" });
}
