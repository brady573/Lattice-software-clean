/**
 * F4 Action Engine — selectMode regressions (Task 3).
 *
 * Deterministic top-down precedence over qualified states: each mode
 * reachable; vetoes that block unjustified ACT; UNKNOWN-never-ACT;
 * oversight-wins over TEST; default WAIT.
 *
 * Held-out note (CA-04): selectMode reads only categorical qualification
 * state plus three boolean step flags — no prose, no model labels, no
 * numbers — so domain wording cannot move the mode by construction.
 * Qualification fixtures below use varied categorical skeletons; identical
 * skeletons must give identical modes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { selectMode } from "../src/action/select.js";
import type {
  ActionCalibration,
  ActionQualification,
  ActionSupport,
  ConsequenceLevel,
  ModeSelectionInput,
  ReversibilityStatus,
} from "../src/action/types.js";

function clearCal(): ActionCalibration {
  return {
    cleared: true,
    resolution: "CLEAR",
    adjustedConfidence: 1,
    materialAffectsAction: false,
    hasUnknownMaterial: false,
  };
}

function weakenAskAffectsAction(): ActionCalibration {
  return {
    cleared: false,
    resolution: "WEAKEN_AND_ASK",
    adjustedConfidence: 0.6,
    materialAffectsAction: true,
    hasUnknownMaterial: true,
  };
}

interface SelOpts {
  readonly consequence?: ConsequenceLevel;
  readonly reversibility?: ReversibilityStatus;
  readonly support?: ActionSupport;
  readonly safeguard?: boolean;
  readonly blocker?: boolean;
  readonly info?: boolean;
  readonly diagnostic?: boolean;
  readonly oversight?: boolean;
  readonly cal?: ActionCalibration;
}

function sel(opts: SelOpts = {}): ModeSelectionInput {
  const qualification: ActionQualification = {
    consequence: opts.consequence ?? "LOW",
    reversibility: opts.reversibility ?? "REVERSIBLE",
    support: opts.support ?? "SUFFICIENT",
    materialBlockerPresent: opts.blocker ?? false,
    safeguardOrAuthorityEstablished: opts.safeguard ?? false,
    blockingUnknowns: [],
  };
  return {
    qualification,
    calibration: opts.cal ?? clearCal(),
    infoStepAvailable: opts.info ?? false,
    diagnosticStepAvailable: opts.diagnostic ?? false,
    oversightRequired: opts.oversight ?? false,
  };
}

test("HIGH plus IRREVERSIBLE with sufficient support and established safeguard still ACTs", () => {
  assert.equal(selectMode(sel({ consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "SUFFICIENT", safeguard: true })).mode, "ACT");
});
test("HIGH plus IRREVERSIBLE with sufficient support but no safeguard vetoes ACT", () => {
  const m = selectMode(sel({ consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "SUFFICIENT" }));
  assert.equal(m.mode, "WAIT");
});
test("UNKNOWN support never ACTs; info step decides INVESTIGATE vs WAIT", () => {
  assert.equal(selectMode(sel({ support: "UNKNOWN", info: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ support: "UNKNOWN" })).mode, "WAIT");
});
test("WEAKEN_AND_ASK with material affectsAction vetoes ACT", () => {
  assert.equal(selectMode(sel({ support: "SUFFICIENT", consequence: "LOW", cal: weakenAskAffectsAction() })).mode, "WAIT");
});
test("[RF-4] TEST-eligible plus oversightRequired escalates", () => {
  assert.equal(selectMode(sel({ support: "PARTIAL", reversibility: "REVERSIBLE", diagnostic: true, oversight: true })).mode, "ESCALATE");
});
test("material blocker with info step investigates, else waits", () => {
  assert.equal(selectMode(sel({ blocker: true, info: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ blocker: true })).mode, "WAIT");
});

test("PARTIAL plus reversible diagnostic tests; irreversible diagnostic cannot test", () => {
  assert.equal(selectMode(sel({ support: "PARTIAL", reversibility: "REVERSIBLE", diagnostic: true })).mode, "TEST");
  assert.equal(
    selectMode(sel({ support: "PARTIAL", reversibility: "PARTIALLY_REVERSIBLE", diagnostic: true })).mode,
    "TEST",
  );
  assert.equal(selectMode(sel({ support: "PARTIAL", reversibility: "IRREVERSIBLE", diagnostic: true })).mode, "WAIT");
  assert.equal(selectMode(sel({ support: "PARTIAL", reversibility: "REVERSIBLE", info: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ support: "PARTIAL", reversibility: "REVERSIBLE" })).mode, "WAIT");
});

test("INSUFFICIENT never acts or tests; info step decides INVESTIGATE vs WAIT", () => {
  assert.equal(selectMode(sel({ support: "INSUFFICIENT", info: true, diagnostic: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ support: "INSUFFICIENT", diagnostic: true })).mode, "WAIT");
});

test("oversight wins over an otherwise-ACT selection", () => {
  assert.equal(selectMode(sel({ support: "SUFFICIENT", consequence: "LOW", oversight: true })).mode, "ESCALATE");
});

test("blocker outranks oversight: blocker plus oversight still investigates, never escalates", () => {
  assert.equal(selectMode(sel({ blocker: true, oversight: true, info: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ blocker: true, oversight: true })).mode, "WAIT");
});

test("reasons are fixed templates over categorical states: deterministic, no numbers, never about authorization", () => {
  const inputs: readonly ModeSelectionInput[] = [
    sel({ consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "SUFFICIENT", safeguard: true }),
    sel({ support: "UNKNOWN", info: true }),
    sel({ support: "PARTIAL", reversibility: "REVERSIBLE", diagnostic: true }),
    sel({ support: "PARTIAL", reversibility: "REVERSIBLE", diagnostic: true, oversight: true }),
    sel({ blocker: true }),
    sel({ support: "SUFFICIENT", consequence: "LOW", cal: weakenAskAffectsAction() }),
    sel({ support: "SUFFICIENT", consequence: "UNKNOWN", info: true }),
    sel({ support: "SUFFICIENT", reversibility: "UNKNOWN" }),
  ];
  for (const input of inputs) {
    const first = selectMode(input);
    const second = selectMode(input);
    assert.equal(first.reason, second.reason);
    assert.match(first.reason, /WAIT|INVESTIGATE|TEST|ACT|ESCALATE/);
    assert.doesNotMatch(first.reason, /\d/);
    assert.doesNotMatch(first.reason, /authorization/i);
  }
});

// --- DP-015 unknown-effect veto (5a/5b/5c) ---

test("dp015_sufficient_unknown_consequence_never_acts", () => {
  const waiting = selectMode(sel({ support: "SUFFICIENT", consequence: "UNKNOWN", reversibility: "REVERSIBLE" }));
  assert.equal(waiting.mode, "WAIT");
  assert.match(waiting.reason, /ACTION_EFFECT_UNKNOWN/);
  const investigating = selectMode(
    sel({ support: "SUFFICIENT", consequence: "UNKNOWN", reversibility: "REVERSIBLE", info: true }),
  );
  assert.equal(investigating.mode, "INVESTIGATE");
  assert.match(investigating.reason, /ACTION_EFFECT_UNKNOWN/);
});

test("dp015_sufficient_unknown_reversibility_never_acts", () => {
  const waiting = selectMode(sel({ support: "SUFFICIENT", consequence: "LOW", reversibility: "UNKNOWN" }));
  assert.equal(waiting.mode, "WAIT");
  assert.match(waiting.reason, /ACTION_EFFECT_UNKNOWN/);
  const investigating = selectMode(
    sel({ support: "SUFFICIENT", consequence: "LOW", reversibility: "UNKNOWN", info: true }),
  );
  assert.equal(investigating.mode, "INVESTIGATE");
  assert.match(investigating.reason, /ACTION_EFFECT_UNKNOWN/);
});

test("dp015_sufficient_both_unknown_never_acts", () => {
  const waiting = selectMode(sel({ support: "SUFFICIENT", consequence: "UNKNOWN", reversibility: "UNKNOWN" }));
  assert.equal(waiting.mode, "WAIT");
  assert.match(waiting.reason, /ACTION_EFFECT_UNKNOWN/);
  const investigating = selectMode(
    sel({ support: "SUFFICIENT", consequence: "UNKNOWN", reversibility: "UNKNOWN", info: true }),
  );
  assert.equal(investigating.mode, "INVESTIGATE");
  assert.match(investigating.reason, /ACTION_EFFECT_UNKNOWN/);
});

test("dp015_sufficient_known_effects_act", () => {
  assert.equal(
    selectMode(sel({ support: "SUFFICIENT", consequence: "LOW", reversibility: "REVERSIBLE" })).mode,
    "ACT",
  );
  assert.equal(
    selectMode(sel({ support: "SUFFICIENT", consequence: "MATERIAL", reversibility: "PARTIALLY_REVERSIBLE" })).mode,
    "ACT",
  );
});

test("dp015_high_or_irreversible_without_safeguard_vetoes_act", () => {
  for (const opts of [
    { consequence: "HIGH", reversibility: "REVERSIBLE" },
    { consequence: "LOW", reversibility: "IRREVERSIBLE" },
  ] as const) {
    const waiting = selectMode(sel({ support: "SUFFICIENT", ...opts }));
    assert.equal(waiting.mode, "WAIT");
    const investigating = selectMode(sel({ support: "SUFFICIENT", ...opts, info: true }));
    assert.equal(investigating.mode, "INVESTIGATE");
    assert.equal(
      selectMode(sel({ support: "SUFFICIENT", ...opts, safeguard: true })).mode,
      "ACT",
    );
  }
});

test("dp015_partial_unknown_reversibility_never_tests", () => {
  assert.equal(
    selectMode(sel({ support: "PARTIAL", reversibility: "UNKNOWN", diagnostic: true })).mode,
    "WAIT",
  );
  assert.equal(
    selectMode(sel({ support: "PARTIAL", reversibility: "UNKNOWN", diagnostic: true, info: true })).mode,
    "INVESTIGATE",
  );
});
