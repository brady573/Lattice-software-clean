# LAT-SHARED-02 — Cross-Role Handoff, Validation & Completion Contract

> Proposed replacement shared Project Source for the Code Validator transition. Install the same reviewed revision in affected Lattice projects before treating it as shared operating authority.

## Purpose

Make Lattice roles operate as one evidence loop without collapsing Product authority, implementation authority, code validation, or user-facing Product validation into one another.

## Preferred loop

OWNER / CORE  
↓  
STEWARD — frame Product barrier and bounded implementation directive  
↓  
CODING AGENT — implement candidate and establish implementation evidence  
↓  
CODE VALIDATOR — independently validate candidate code and suggest remediation  
↓  
CODING AGENT — apply authorized remediation when needed  
↓  
USER-FACING VALIDATION WORKFLOW — establish observable Product behavior  
↓  
STEWARD — reconcile Product evidence against Core and recommend next Product action  
↓  
OWNER — resolve remaining Product/authority questions

This is a default coordination pattern, not a requirement to invoke every stage for every small task.

## Steward → Coding Agent directive

When implementation is needed, the Steward directive should contain as applicable:

- `TARGET` — repo and required fresh base;
- `PRODUCT OUTCOME` — user-facing barrier or capability;
- `AUTHORITY` — governing Owner/Core basis;
- `OBSERVED GAP` — fresh evidence and evidence state;
- `BOUNDARIES` — what may change and what must remain protected;
- `BEHAVIORAL ACCEPTANCE` — user-observable or trust-relevant outcomes;
- `IMPLEMENTATION VALIDATION` — evidence required from the candidate;
- `GENERAL-CAPABILITY REQUIREMENT` — when cognition is involved;
- `NON-GOALS` — forbidden expansion;
- `STOP CONDITIONS` — conditions requiring report/escalation rather than coding.

The Steward specifies Product outcome and boundaries, not hidden reasoning or unnecessary work organization.

## Coding Agent → Code Validator / Steward implementation report

Use:

`STATUS`  
`BASE` — repo, starting SHA/tree  
`CANDIDATE` — branch/ref, final SHA/tree, PR if applicable  
`USER-FACING OUTCOME`  
`CHANGED BOUNDARY` — modified, removed, preserved  
`IMPLEMENTATION CLAIMS`  
`VALIDATION` — exact commands/workflows and results  
`DEPENDENCY / ENVIRONMENT CHANGES`  
`CORE BOUNDARIES PRESERVED` — provenance; truth/uncertainty; authority; privacy/security; authorization/execution/verification as relevant  
`LIMITATIONS` — unproven conditions  
`DEVIATIONS` — departure from directive

Coding Agent claims are evidence inputs. They do not self-certify code correctness or Product readiness.

## Code Validator report

For substantial code validation use:

`ASSESSMENT` — NO_MATERIAL_FINDINGS / FINDINGS_PRESENT / BLOCKED / UNKNOWN  
`CANDIDATE`  
`SCOPE`  
`INTENDED BEHAVIOR`  
`FINDINGS`  
`EXTERNAL CHALLENGE`  
`VALIDATION EVIDENCE`  
`SUGGESTED REMEDIATION`  
`VERIFICATION`  
`REMAINING UNCERTAINTY`  
`HANDOFF`

Suggested remediation is advisory unless implementation is explicitly authorized.

`NO_MATERIAL_FINDINGS` means no material defect was established within the stated scope and evidence; it does not prove defect absence or Product readiness.

## User-facing validation workflow

The user-facing validation workflow establishes whether the applicable Product path actually provides the intended observable outcome and trust behavior.

Code Validator results may inform reproduction, candidate identity, and diagnosis. They cannot substitute for direct Product evidence when the Product claim depends on user-observable behavior.

## Completion meanings

### Implementation candidate complete

The bounded requested implementation exists on the identified candidate and required implementation evidence has been produced.

This does not mean:

- merged;
- deployed;
- canonical;
- defect-free;
- Product accepted.

### Code validation — NO_MATERIAL_FINDINGS

No material implementation defect was established within the declared scope and available evidence.

This does not mean:

- every path was inspected;
- the candidate is secure in all contexts;
- architecture is ideal;
- Product behavior passed;
- merge/deploy is authorized.

### User-facing Product validation success

Sufficient direct Product evidence establishes the claimed user-observable outcome through the applicable Product path.

This does not mean:

- architecture is ideal;
- all code defects are absent;
- roadmap work is complete;
- merge/deploy is authorized;
- the Core has changed.

### Steward direction assessment

The Steward may assess Product-direction alignment under its governing source set. That assessment does not override direct contradictory Product evidence or authorize implementation outside its role boundary.

## Conflict handling

If Coding Agent and Code Validator disagree about implementation state:

- preserve both claims;
- fresh direct repository/tool/runtime evidence controls the implementation-state question within its scope;
- unresolved version/environment differences remain explicit;
- do not infer bad intent.

If Code Validator evidence conflicts with repository comments/tests:

- preserve the contradiction;
- determine which evidence is authoritative for the specific claim;
- tests/comments do not override external technical semantics merely because they agree with the implementation.

If Code Validator and user-facing validation disagree:

- code evidence controls implementation claims within its scope;
- direct Product evidence controls user-observable Product claims within its scope;
- neither silently substitutes for the other.

If Steward and user-facing Product evidence disagree:

- preserve both;
- Product-direction analysis cannot rewrite direct observed behavior;
- observed behavior does not itself amend Product authority.

The Owner resolves remaining Product-authority ambiguity and major architecture/authorization decisions.

## No circular self-certification

A role must not establish the truth of its own broad claim merely by producing the artifact asserting it.

Examples:

- implementation is not proven correct because the coder says it is;
- code is not proven correct because repository tests encode the same assumption;
- Product is not aligned merely because a directive says it is;
- Product behavior is not proven by a non-user-facing subsystem check;
- external technical reality is not established by a repository comment quoting itself.
