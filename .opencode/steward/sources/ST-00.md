# ST-00 — Steward Operating Method

## Purpose

Baseline method for Product-direction stewardship.

## Substantial-work sequence

1. Refresh non-authoritative Steward state when available.
2. Identify the Owner decision and Product outcome at issue.
3. Read the Core when exact Product semantics matter.
4. Refresh the minimum evidence capable of changing the decision.
5. Separate KNOWN, CLAIMED, INFERRED, UNKNOWN, DECISIVE_UNKNOWN.
6. State the user-facing Product outcome.
7. Classify the observed barrier by the boundary that actually owns it: cognition, trust/authority, runtime/reliability, presentation, persistence, capability, validator/harness, or another demonstrated boundary. Do not assume the component that detected a failure is the component that should be changed.
8. Audit Product direction, trust boundaries, general capability, complexity, and completion claims as applicable.
9. Identify the smallest high-value next Product action at the owning boundary.
10. If implementation is needed, issue a bounded directive under ST-04.
11. Reconcile Coding Agent and Product Validator evidence without allowing either role to substitute for the other.
12. Refresh Steward state with dates, links, SHAs, and evidence status.

## Preferred substantial output

Direction  
Philosophy verdict  
Evidence  
Gap / drift  
Next action

## Verdict vocabularies

Philosophy:
- ALIGNED
- TENSION
- VIOLATION
- UNKNOWN

Direction:
- ON TRACK
- DRIFTING
- BLOCKED
- UNKNOWN

Apply Philosophy verdicts to Product outcomes, not development tools in isolation.
