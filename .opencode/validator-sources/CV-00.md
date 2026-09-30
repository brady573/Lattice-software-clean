# CV-00 — Code Validation Method

## Purpose

Baseline method for independent Lattice code validation.

## Core question

For the identified candidate and scope, does the implementation satisfy its intended technical behavior without material correctness, reliability, security, compatibility, or regression defects supported by the available evidence?

## Evidence planes

Keep four materially different planes separate:

1. **Product / requirement authority** — what should happen.
2. **Candidate reality** — what the inspected repository revision actually contains or does.
3. **External technical reality** — what languages, runtimes, frameworks, APIs, protocols, platforms, dependencies, and standards actually guarantee for the applicable versions.
4. **Execution evidence** — what tests, builds, runtime reproduction, analysis tools, and observed behavior establish in the inspected environment.

No plane silently substitutes for another.

## Validation modes

### DIFF_REVIEW
Default for PRs, commits, branches, bounded Coding Agent candidates, and focused changes.

Review the diff plus enough surrounding code to understand affected control flow, data flow, state, invariants, callers/callees, configuration, tests, and dependencies. Expand scope when the change crosses a trust, lifecycle, concurrency, persistence, or compatibility boundary.

### BASELINE_REVIEW
Use for inherited systems, broad security or reliability audits, major architecture transitions, post-incident work, or explicit full-subsystem validation.

### TARGETED_INVESTIGATION
Use for a named hypothesis such as race condition, leak, data corruption, auth bypass, performance regression, flaky test, incorrect API use, or dependency vulnerability.

### RETEST
Use after remediation or another material change. Reuse still-valid evidence, but refresh evidence invalidated by the change.

## Substantial validation sequence

1. **Candidate identity** — establish repo, ref, SHA/tree if available, dependency state, environment, and review mode.
2. **Requested scope** — state what is in and out of scope.
3. **Intended behavior** — establish applicable requirement, directive, contract, or invariant. Do not derive Product intent from implementation state.
4. **Change / impact map** — identify modified behavior and neighboring boundaries that could be affected.
5. **Direct code inspection** — trace material control flow, data flow, state transitions, failure paths, lifecycle, and interfaces.
6. **External Challenge Pass** — identify external assumptions that could materially alter the conclusion; verify the material ones under `CV-03`.
7. **Evidence execution** — run or inspect the most relevant tests, build checks, static analysis, dynamic analysis, reproduction, benchmarks, or other tools when available and useful.
8. **Finding synthesis** — separate established defects from hypotheses, tool alerts, and unresolved unknowns.
9. **Remediation** — propose the smallest safe correction supported by evidence, including material trade-offs and alternatives.
10. **Verification plan** — specify how the correction should be independently established.
11. **Scoped assessment** — issue `NO_MATERIAL_FINDINGS`, `FINDINGS_PRESENT`, `BLOCKED`, or `UNKNOWN` only for the declared scope.

## Candidate identity and freshness

Record when material:

- repository;
- branch/ref;
- SHA/tree or equivalent immutable revision;
- dirty working-tree state;
- dependency lock state;
- build/runtime environment;
- tool versions materially affecting results;
- exact commands/workflows run;
- governing directive/spec revision;
- relevant external source version/date.

Old evidence is not automatically current evidence.

Revalidate when a material input changes, including code, dependency, lockfile, compiler/runtime, operating environment, build configuration, relevant external service/API behavior, governing requirement, evaluator, or analysis tool.

## Scope discipline

A validation result is only as broad as the evidence establishing it.

Examples:

- unit test → tested behavior in that test/environment;
- static-analysis alert → a candidate issue requiring interpretation;
- successful build → buildability in the observed configuration;
- benchmark → measured behavior for the tested workload/environment;
- diff review → reviewed change and materially affected boundaries;
- baseline review → only the subsystem and conditions actually inspected.

Do not translate scoped evidence into claims such as “the code is correct,” “secure,” or “production ready” without evidence broad enough to establish that claim.

## Evidence states

Use the shared evidence vocabulary:

- `KNOWN`
- `CLAIMED`
- `INFERRED`
- `UNKNOWN`
- `DECISIVE_UNKNOWN`

Tool output is not automatically `KNOWN` for the tool's interpretation. The direct tool result may be `KNOWN`, while the defect inferred from it may remain `INFERRED` until confirmed.

## Assessment states

### NO_MATERIAL_FINDINGS
No material defect was established within the stated scope and available evidence.

This is not proof that no defect exists.

### FINDINGS_PRESENT
One or more supported material findings require attention.

### BLOCKED
A required condition prevents meaningful validation. State the blocker and what evidence is missing.

### UNKNOWN
Evidence is insufficient for a justified scoped conclusion.

Never turn `BLOCKED` or `UNKNOWN` into `NO_MATERIAL_FINDINGS`.

## No self-certification shortcut

The following cannot independently prove implementation correctness:

- Coding Agent completion claims;
- green CI;
- repository tests that encode the same assumption as the implementation;
- comments or design documents;
- a scanner reporting no alerts;
- a previous validator report about another revision.

Use them as evidence according to the claim they actually establish.
