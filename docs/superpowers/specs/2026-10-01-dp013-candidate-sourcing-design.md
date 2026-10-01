# DP-013 Structured Candidate Sourcing — Design Spec (2026-10-01)
Status: APPROVED design (DP-013 decisions + §§1–6 corrections). No building authorized by this document.

## 1. Authority
Core Trustworthy Intelligence for Action, Q→U→C→A. DP-010 (deterministic selection, models propose only), DP-011 (F4 owns qualification, UNKNOWN first-class, no persistence), DP-012 (after F6, orchestrator-invoked, candidate-gated, three states). F4 spec docs/superpowers/specs/2026-09-30-f4-action-engine-design.md. Roadmap F4 row. DP-013 answers: OPTIONAL SOLANDRA ADVISORY PROPOSAL; model semantics for applicability, Lattice structural admission; 0..1 candidates; candidate originates NO governed references; model consequence/reversibility labels PROHIBITED; malformed candidate → DROP CANDIDATE, PRESERVE RECOMMENDATION; missing facts → UNKNOWN; Decision Engine DEFERRED; prompt/contract change AUTHORIZED within this bounded scope.

## 2. Pipeline (corrected order)
Solandra advisory output → strict recommendation validation → optional ActionCandidate admission (invalid candidate → absent) → F6 Assumption Guard → Action-facing calibration projection + admitted candidate + validated recommendation/intent basis → F4 evaluate() → finalization. Admission runs after recommendation acceptance; projection runs after F6 (needs post-F6 calibration). F6 owns assumption calibration; F4 owns the justified next move.

## 3. Advisory contract (§1, corrected mechanics)
recommendationSchema stays .strict(). The candidate is separately admitted optional proposal material: parse the recommendation envelope including optional raw candidate material, then independently safeParse that candidate into the bounded ActionCandidateProposal { action: string (bounded like other prose fields); expectedOutcome?: string; verification?: string }. Candidate failure → undefined; malformed required recommendation fields still fail normally. Never weaken .strict() for unrelated advisory fields. Zero authority-bearing fields; candidate originates no governed references.

## 4. Prompt discipline (§2)
Describe the candidate as one optional prospective next move naturally following the advisory recommendation; proposal material only. Prohibitions: must not state whether Lattice should authorize/execute it, classify safety/consequence/reversibility, or select a mode. INVESTIGATE/TEST/ACT/WAIT/ESCALATE and all F4 vocabulary stay out of the prompt.

## 5. Admission + projection (§3, split)
Two deterministic operations (one small module permitted): (a) candidate admission — independently validate the optional proposal; invalid means absent; (b) F4 input projection — combine admitted candidate with authoritative intent/basis and narrow F6 Action calibration. Projection maps but never classifies consequence/reversibility/support policy. No lexical policing of prose.

## 6. Orchestration (§4)
Existing bypass sites receive the validated candidate when present: actionDecision = candidate !== undefined ? evaluate(...) : undefined. Absence = no ActionDecision (never WAIT). WEAKEN_AND_ASK interplay unchanged. Decision Engine untouched; F4 stays source-agnostic.

## 7. Governed-fact mapping (Q7 table, condensed)
Candidate action ← actionCandidate.action (required proposal, non-authoritative). Expected outcome / verification ← optional proposal material, never evidence. Goal ← exact current IntentVersion. Basis ← validated Recommendation basis (candidate adds no references). Assumptions ← F6 projection. Support ← basis + calibration, derived, no model labels. Consequence/reversibility ← structured governed facts if available, else UNKNOWN. Capability facts ← only within declared boundary. Authorization/execution/verification state ← never candidate-sourcing inputs.

## 8. Testing (§5 + boundary test)
Schema tests (valid accepted; malformed → absent; strictness preserved; absent → identical behavior); FAILURE-BOUNDARY test: invalid required recommendation field rejects the advisory result AND invalid optional candidate only removes eligibility (proves tolerance didn't make the schema permissive); adapter tests (projection, drop rules, UNKNOWN defaults); orchestration tests; determinism. Held-out phrasings; no example-derived thresholds.

## 9. Non-goals (§6)
No persistence, RecommendationRecord authority, Decision Engine changes, second model call, prose parsing, F8 coupling, authorization/execution/verification/Action Preparation changes, manufactured candidates.
