# F4 Action Engine — Design Spec (2026-09-30)

Status: APPROVED design (DP-010 through DP-012 + Approach A + §§1–6 corrections). No building authorized by this document.

## 1. Authority

- Core: Trustworthy Intelligence for Action, Question → Understanding → Confidence → Action. F4 is the Action-stage decision boundary: it translates calibrated understanding into a justified next move, with consequence and reversibility raising the evidentiary bar, never blanket prohibitions; unsupported dependencies stay explicit, never silently inferred.
- DP-010 (APPROVED): deterministic mode selection; models PROPOSE/EXPLAIN, never select the authoritative mode; no F8 coupling in this slice.
- DP-011 (APPROVED): F4 owns deterministic pre-selection qualification (qualifyAction → selectMode); categorical states; UNKNOWN first-class; no persistence; no peer subsystem; facts stay with existing owners.
- DP-012 (APPROVED): placement after F6, orchestrator-invoked, candidate-gated, three states (none / WAIT / other), live inputs, F6 owns the assumption / F4 owns the justified move.
- Approach A (APPROVED): mirror F6 with src/action/ pure module. Approach B rejected (obscures authority). Approach C deferred (no persistence for v1).
- Roadmap: docs/REALIGNMENT-ROADMAP.md F4 row (SCOPED / READY FOR IMPLEMENTATION PLANNING).

## 2. Product interpretation

F6 = Confidence-stage assumption calibration. F4 = Action-stage qualification + deterministic mode selection. F4 is NOT a third Confidence gate. The two orchestration call sites are implementation locations, not independent policies: one shared Action Engine contract, so semantics cannot drift by path.

## 3. Module and contract (§1, narrowed)

- New src/action/, pure, deterministic, ephemeral, read-only. Files (Engineering may adapt): types, qualifyAction, selectMode, index, evaluate() composing qualification → selection.
- Input contract (narrow): candidate + actionCalibration + qualified governed facts. F4 MUST NOT depend on the full F6 implementation type or an unbounded governedContext bag. Define an Action-facing projection of the calibrated state and enumerate the structured governed facts F4 may consume (candidate proposal material; F6 calibrated signals incl. cleared/resolution/adjustedConfidence/material assumptions/affectsAction; consequence/reversibility-establishing facts from Intent Authority, Knowledge/V36, Decision Engine results, capability effect properties). This preserves the F6/F4 boundary and prevents context creep.
- Output ActionDecision: mode, action, reason, expectedOutcome, risk, reversibility, verification, blockingUnknowns.
- Qualification states (categorical; exact names implementation-level): consequence LOW/MATERIAL/HIGH/UNKNOWN; reversibility REVERSIBLE/PARTIALLY_REVERSIBLE/IRREVERSIBLE/UNKNOWN. Qualifier classifies ONLY from structured governed facts; never parses prose. Model-authored risk labels are not qualification evidence.

## 4. Selection rules (§2, corrected)

Explicit precedence over qualified states (dimensions, not a numeric lookup):

- material unresolved blocker preventing responsible action → WAIT or INVESTIGATE;
- evidence insufficient but a useful information-producing step exists → INVESTIGATE;
- partial support + bounded/reversible diagnostic exists → TEST;
- sufficient support + acceptable consequence/reversibility → ACT;
- external expertise/oversight required for a responsible next decision → ESCALATE.

Consequence rule (corrected): HIGH consequence and/or IRREVERSIBLE status RAISES the justification requirement and vetoes ACT when the stronger support, safeguards, or required decision authority are not established. Sufficiently strong governed support CAN still produce ACT — high consequence never categorically forbids action.

ESCALATE means external expertise/oversight is required, NOT merely that later execution needs authorization (authorization is a separate boundary).

Missing material input fails toward the less-consequential mode; ties prefer more reversible/diagnostic/information-producing; never model arbitration. Identical governed inputs → identical mode and justification-relevant state, regardless of model/provider availability.

## 5. Orchestration integration (§3)

At both F6 finalization sites: assumptionScreening = guardAdvisoryConclusion(...) → actionCalibration = projectActionCalibration(assumptionScreening) → qualifiedFacts = collectPermittedActionFacts(...) → actionDecision = candidate !== undefined ? actionEngine.evaluate({ candidate, actionCalibration, qualifiedFacts }) : undefined → finalize({recommendation, actionDecision}). F4 receives only the bounded projection (actionCalibration + qualifiedFacts), never F6 internals or a general context bag. Helper names are illustrative; implementation naming belongs to the later plan. Runs after F6 even on WEAKEN_AND_ASK without suppressing/answering/reinterpreting the clarification. Presentation consumes only; RecommendationStore never invokes.

## 6. Candidate sourcing (§4, structured requirement)

F4 never invents candidates. The candidate MUST carry the structured facts necessary for qualification, or references to governed facts establishing them; a plain action string plus model-authored labels is insufficient. Absent facts → qualification yields UNKNOWN (F4 does not parse wording to recover them). No candidate → orchestrator skips F4 → no ActionDecision (never WAIT). Pure Knowledge turns ordinarily bypass F4.

## 7. Testing (§5 + added case)

Unit matrices over structured governed inputs: each mode reachable; UNKNOWN blocking unjustified ACT while permitting INVESTIGATE/WAIT; HIGH/IRREVERSIBLE NOT categorically forbidding ACT when stronger requirements satisfied (explicit case); WEAKEN_AND_ASK passthrough with clarification preserved; determinism independent of model availability; no-candidate → no decision. Held-out domains/phrasings; no example-derived thresholds.

## 8. Non-goals and stop conditions (§6)

No persistence, store, Decision Engine, capability, authorization, execution, or Action Preparation changes; no model call; no F8 emission. Prompt-change caveat: if advisory output cannot supply a structured candidate without a cognition-contract change, STOP and surface that dependency — do not quietly add prompt fields.
