# Lattice Repository Adapter

This file contains repository-local operating guidance for Lattice Software. It does not replace explicit Owner direction, installed Project guidance, Product specifications, safety/security/privacy requirements, production controls, or cost constraints.

Lattice is a single-owner hobby project. Repository process exists only to help the Owner ship a reliable, understandable Lattice 1.0. Do not introduce team ceremony, reviewer quorums, role handoffs, issue-tracker synchronization, enterprise operations programs, or paid infrastructure merely because they are conventional elsewhere.

## Canonical repository sources

Before substantive implementation work, inspect the checked-out revision and the relevant Product sources in this repository.

Primary Product sources, in repository-design order:

- `docs/design/The-Core-Lattice-Philosophy.md` — Owner-approved highest Product philosophy authority and exclusion test. Every subordinate Product source, architecture, implementation, feature, workflow, interface, and retained mechanism must conform to it; conflicting elements must be changed, removed, or explicitly reconciled by the Owner.
- `docs/design/Lattice-Foundational-Design-Principle.md` — Owner-approved foundational Product design intent subordinate to the Core philosophy. It elaborates the Core and may add precision only where that detail remains aligned with it.
- `docs/design/Lattice-Living-Software-Design-to-1.0.md` — canonical living Product design and forward 1.0 roadmap. Respect its item-level status: Confirmed items govern; Working assumptions remain reversible; Proposed/Open items do not independently authorize Product mutation.
- `docs/design/Lattice-System-Registry-and-Naming.md` — Owner-approved canonical names and authority-boundary vocabulary for Lattice Product systems.
- `docs/design/Lattice-Architecture-Integrity.md` — Owner-approved cross-cutting Product-semantic integrity constraints.
- `docs/specifications/Lattice-Product-Concept.txt` — Product concept and intent source.
- `docs/specifications/SPEC-1-Lattice-Rebuilt/` — detailed qualified implementation specification for confirmed contracts not explicitly superseded by the living design.
- `docs/specifications/V36-Truth-Layer/` — protected V36 truth-core contract; `claim-proof-contracts.json` is the exact proof-obligation contract.
- `docs/ROADMAP.md` — derived execution/status view of the living roadmap; it is not independent design authority.
- current implementation under `src/`;
- current tests under `test/`;
- `README.md` for the currently supported prototype surface; and
- `package.json` plus `package-lock.json` for executable scripts, runtime requirements, and dependency resolution.

When an older SPEC-1 roadmap/build-sequence label conflicts with the living design's forward M0-M12 sequencing, use the living design for forward sequencing. Preserve detailed confirmed SPEC-1 and V36 behavioral contracts unless an authoritative source explicitly supersedes them, but no subordinate Product source may override `The-Core-Lattice-Philosophy.md`.

Use canonical system vocabulary where the distinction is material: **Lattice Product**, **Lattice Intent Authority**, **Lattice Execution Runtime**, **Lattice Model Gateway**, **V36 Truth Core**, **Lattice Decision Engine**, **Solandra Experience**, and the external **V7 LLM Simulation Lab**. Process-role/module names such as `run-worker`, `research-worker`, `product/intent`, or `presentation/solandra` describe implementation organization; they do not independently redefine Product authority.

Do not infer current behavior from detached copies, prior analyses, old screenshots, stale plans, or older commits when current source can be inspected directly.

## Core Product-design filter

Apply `docs/design/The-Core-Lattice-Philosophy.md` **first**, before every other Product-design filter and before selecting architecture, feature shape, implementation mechanism, provider, workflow, UI treatment, or validation strategy.

The first question is whether the proposed or retained element belongs in Lattice at all:

> **Does this use knowledge to remove a meaningful barrier for the user, preserve the boundaries required for trust and human control, keep authority where it belongs, and reduce rather than transfer unnecessary complexity?**

If the answer is no, the element does not belong in the software unless the Owner explicitly amends or supersedes the Core philosophy. Historical presence, lower-level specification, partial implementation, architectural convenience, sunk cost, or prior approval are not reasons to retain a conflict.

Only after a proposal passes the Core check should `docs/design/Lattice-Foundational-Design-Principle.md` and the other subordinate Product sources be applied for additional precision, qualification, architecture, sequencing, implementation, and validation requirements.

For every material Product change that passes the Core check, establish:

1. the meaningful user barrier being removed or reduced;
2. the trustworthy knowledge, understanding, or decision capability made easier to reach;
3. the trust, semantic-authority, and human-control boundaries that must remain intact;
4. why the proposed complexity earns its place versus a simpler governed design; and
5. the cheapest Product-observable evidence that can show the intended improvement.

If a proposal cannot establish a Product benefit, do not advance it merely because it is technically interesting, conventional, already documented, or partially implemented.

For Lattice 1.0, operational and reliability requirements are outcome requirements, not invitations to recreate a staffed production organization. Prefer the smallest zero-cost mechanism that provides the required recovery, isolation, observability, backup/restore, or rollback outcome. Staffed on-call rotations, formal SLO programs, SIEM programs, multi-region failover, enterprise compliance programs, or similar machinery are not implied requirements unless the Owner explicitly promotes them.

## Inspect the checked-out revision

Record the exact source state before editing:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
node --version
npm --version
```

When network access is available and freshness matters, update remote refs without rewriting the working tree:

```bash
git fetch origin --prune
git rev-parse origin/main
```

Do not reset, clean, overwrite, or discard unrelated Owner work.

## Runtime and dependency contract

The supported local runtime is currently:

- Node.js 24.x
- npm 11+

Check `package.json` before relying on these values because repository-local requirements may evolve.

`package-lock.json` is the dependency-resolution contract. Install dependencies with:

```bash
npm ci
```

If `package.json` dependencies intentionally change, regenerate and validate the lockfile on the supported runtime and commit both files together.

Prefer built-in, local, open-source, and genuinely free development paths when they are adequate. Do not enable a paid provider, subscription, hosted runner, recurring cloud resource, or other billable dependency without explicit Owner authorization.

## Build and test

Use the scripts defined by the checked-out `package.json` rather than inventing alternate commands.

Current commands:

```bash
npm run build
npm test
npm run check
```

`npm run check` is the aggregate local gate and currently runs the TypeScript build followed by the deterministic test suite.

For a focused change, run the narrowest discriminating check first when practical. Run the broader repository gate when the affected surface justifies it. Documentation-only changes do not need expensive unrelated runtime validation; check links, wording, scope, and repository diff instead.

## Product validation

Passing build/unit/integration checks is evidence only for the paths they exercise; it is not automatically Product acceptance.

For a material Product change:

1. derive acceptance criteria from the relevant qualified or Owner-approved Product requirement;
2. identify the externally observable behavior affected by the change;
3. execute the cheapest relevant Product-observable probe;
4. run targeted tests;
5. run broader regression checks when the affected surface warrants them;
6. compare observed behavior with the bound acceptance criteria; and
7. report the exact tested revision and any untested acceptance surface.

If a specification and current implementation disagree, investigate the conformance question. Do not silently redefine the specification from existing behavior.

## CI validation architecture

`docs/development/ci-validation-architecture.md` documents repository-local GitHub Actions responsibilities. `test/ci-workflow-scope.test.ts` protects the intended lane boundaries through the ordinary test gate.

Keep CI proportional to this one-owner project:

- one durable core validation path should own ordinary repository validation;
- specialist lanes should exist only for genuinely distinct execution surfaces such as PostgreSQL integration, browser behavior, deployment configuration, or bounded model benchmarking;
- milestone names, temporary incidents, provider experiments, or historical acceptance campaigns do not justify permanent workflows by themselves;
- compatibility checks should not duplicate validation work;
- one-off research evidence may remain manual/non-required when automation would add more maintenance than value; and
- no CI design may assume paid GitHub capacity or hosted-runner budget unless the Owner explicitly authorizes it.

A workflow result supports only the exact revision and surface it actually exercised. Required-status names and control-plane configuration are not Product evidence.

## Change discipline

Keep repository changes scoped to the requested Product objective. Inspect current source before editing, preserve unrelated work, add regression coverage when it materially protects behavior, review the final diff, and record the exact ending revision.

Use branches, commits, or pull requests when they improve recoverability or review value. They are tools, not mandatory ceremony for every change.

Do not copy external governance documents into this repository or turn repository guidance into an alternate constitution. The repository should remain understandable to one Owner working with one Copilot.
