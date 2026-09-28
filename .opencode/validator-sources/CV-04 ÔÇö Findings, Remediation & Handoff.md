# CV-04 — Findings, Remediation & Handoff

## Purpose

Standardize defect findings, severity/confidence, suggested remediation, verification, and downstream handoff.

## Finding threshold

Create a finding when evidence supports a material implementation defect, risk, or violated technical requirement within scope.

Do not create a defect finding merely for:

- personal style preference;
- speculative architecture improvement;
- an unconfirmed scanner alert;
- hypothetical behavior with no plausible path or requirement impact;
- differences from repository convention without a correctness/security/maintainability consequence established by scope.

Track unresolved material hypotheses as uncertainty instead.

## Finding schema

For each material finding state:

`ID`  
`TITLE`  
`AFFECTED REVISION / LOCATION`  
`CONDITION` — state/input/environment required  
`EXPECTED / REQUIRED BEHAVIOR`  
`ACTUAL / INFERRED BEHAVIOR`  
`CONSEQUENCE`  
`EVIDENCE STATE` — KNOWN / CLAIMED / INFERRED / UNKNOWN / DECISIVE_UNKNOWN  
`SEVERITY`  
`CONFIDENCE`  
`REPOSITORY EVIDENCE`  
`EXTERNAL EVIDENCE` — when material  
`REPRODUCTION / VALIDATION` — when available  
`SUGGESTED REMEDIATION`  
`TRADE-OFFS / ALTERNATIVES` — when material  
`VERIFICATION`  
`REMAINING UNCERTAINTY`

## Severity

Severity is the consequence if the finding is real under the stated condition. It is not confidence.

### CRITICAL

Likely catastrophic security/privacy/authorization impact, destructive corruption, severe supply-chain compromise, or other failure with extreme consequence requiring immediate containment/escalation.

### HIGH

Material security boundary failure, data corruption/loss, major core-function failure, widespread outage risk, serious compatibility break, or defect likely to require urgent correction before release/use.

### MEDIUM

Material but bounded correctness, reliability, performance, compatibility, maintainability, or security weakness with meaningful user/operational consequence.

### LOW

Limited defect or robustness issue with small consequence but legitimate remediation value.

Do not inflate severity to compensate for uncertainty.

## Confidence

### HIGH

Direct candidate/runtime evidence or highly applicable authoritative evidence establishes the finding with little unresolved ambiguity.

### MEDIUM

Evidence strongly supports the finding but one or more non-decisive assumptions remain.

### LOW

The risk is plausible and material enough to report, but important facts remain unresolved.

If an unresolved fact could reverse the finding or materially change next action, mark it `DECISIVE_UNKNOWN` and consider whether the overall assessment must be `UNKNOWN` or `BLOCKED`.

## Remediation contract

Suggested remediation is advisory unless implementation is explicitly authorized.

For each material finding prefer:

**smallest safe correction → evidence that it addresses the condition → material side effects/trade-offs → verification**

A remediation should:

- remove or contain the demonstrated failure condition;
- preserve applicable requirements and trust boundaries;
- avoid unrelated redesign;
- account for compatibility/migration consequences;
- include regression protection where appropriate;
- identify when a broader architecture decision is genuinely required.

When multiple approaches are materially viable, provide the primary recommendation plus alternatives and trade-offs. Do not present aesthetic preference as technical necessity.

## Architecture escalation

Broader architecture replacement may be suggested only when evidence shows the defect cannot be safely or sustainably resolved within the existing boundary, or when the user explicitly requests architectural alternatives.

Architecture remains a proposal, not validator authority.

## Verification contract

Every remediation should include evidence that would establish success, such as:

- a specific regression test;
- reproduction no longer failing;
- build/type/static analysis result;
- sanitizer/fuzzer/property test;
- dependency graph/advisory check;
- performance measurement under stated workload;
- protocol/API conformance check;
- focused manual inspection of the repaired invariant.

Verification must target the original failure mode, not merely show that unrelated tests remain green.

## Overall assessment

Use only:

### NO_MATERIAL_FINDINGS
No material defect was established within the declared scope and evidence. State important exclusions/unknowns.

### FINDINGS_PRESENT
At least one supported material finding exists.

### BLOCKED
A required input, access path, environment, candidate identity, or external fact prevents meaningful validation.

### UNKNOWN
Evidence remains insufficient for a justified scoped conclusion.

The assessment is not a Product readiness verdict and does not authorize merge/release/deploy.

## Substantial validation report

Use:

**ASSESSMENT**  
**CANDIDATE** — repo/ref/SHA/environment  
**SCOPE** — reviewed and excluded  
**INTENDED BEHAVIOR** — requirement/invariant basis  
**FINDINGS** — ordered by material consequence; do not hide lower-confidence material findings  
**EXTERNAL CHALLENGE** — external assumptions checked, source applicability, contradictions/unknowns  
**VALIDATION EVIDENCE** — exact tests/tools/reproduction and results  
**SUGGESTED REMEDIATION** — smallest supported correction per finding  
**VERIFICATION** — evidence required after remediation  
**REMAINING UNCERTAINTY**  
**HANDOFF** — Coding Agent, Steward, Owner, or user-facing validation workflow as appropriate

## Handoff rules

### To Coding Agent

Provide bounded defects, evidence, remediation suggestions, protected behavior, and exact verification targets. Do not silently authorize unrelated changes.

### To user-facing validation workflow

Provide candidate identity and implementation evidence useful for reproduction. Do not convert code-validator assessment into Product PASS.

### To Steward

Escalate requirement tension, Product consequence, or architecture proposals requiring Product-direction review.

### To Owner

Escalate Product-semantic ambiguity, major architecture replacement, material scope expansion, or authorization decisions reserved to the Owner.
