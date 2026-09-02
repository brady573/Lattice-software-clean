# CI Validation Architecture

Status: Owner-approved repository-local Product/development contract for the 2026-09-01 CI scope-drift prevention Work Item.

This document governs repository validation-lane responsibility. It does not replace installed Team governance, Product requirement qualification, exact-revision validation rules, production/cost/security boundaries, or GitHub control-plane configuration.

## Objective

Keep validation evidence understandable, bounded, and inexpensive as Lattice grows. A workflow exists because it owns a durable validation responsibility, not because a milestone, platform, temporary prototype, runner incident, provider experiment, or one-off acceptance campaign once needed a workflow.

## Core invariants

1. **One ordinary repository gate.** `Core PR validation` is the only ordinary workflow job that owns the complete `npm run check` gate. It executes that gate once per Core job.
2. **Specialist lanes stay specialist.** PostgreSQL, browser/E2E, deployment-configuration, and research/benchmark lanes execute only the checks materially required by their own responsibility. They do not become alternate full-repository gates merely because their execution surface can run those checks.
3. **Workflow success is not Product acceptance.** Specialist workflows must not emit `MILESTONE_ACCEPTANCE=PASS`, `PRODUCT_ACCEPTANCE=PASS`, `PRODUCTION_READINESS=PASS`, or equivalent claims. A workflow may report only the bounded surface it actually exercised.
4. **Required checks use durable responsibility names.** A milestone, operating system, runner, prototype, provider, or temporary campaign name must not become a new permanent required-status identity unless that property itself is the enduring validation responsibility.
5. **Compatibility checks are temporary control-plane migration aids only.** If a compatibility status is ever temporarily required during a future ruleset migration, it must execute no validation work and must be removed immediately after the external dependency is gone.
6. **Historical evidence remains historical.** Old acceptance records keep the exact workflow/run names that actually produced their evidence. Historical names do not define the current CI architecture.
7. **Exceptions are explicit and bounded.** A temporary legacy exception must be named in the executable guard and pinned tightly enough that additional scope cannot accumulate silently.
8. **Zero recurring cost remains the default.** Prefer existing authorized development execution surfaces and avoid adding paid runners/services solely to implement CI structure.

## Durable lane ownership

| Responsibility | Current workflow | Owns | Must not own |
|---|---|---|---|
| Core PR validation | `.github/workflows/windows-validation.yml` | exact source/runtime preflight, locked install, one `npm run check` | PostgreSQL-specific, browser-specific, milestone acceptance |
| PostgreSQL integration | `.github/workflows/postgres-persistence-validation.yml` | PostgreSQL 18 preflight, schema reset, database-dependent integration tests | full repository gate, browser acceptance, milestone acceptance |
| Browser / E2E | currently `.github/workflows/m7-browser-lifecycle-validation.yml` | target state: browser/client-observable behavior and browser-specific prerequisites | general repository gate, general PostgreSQL regression catalog, milestone identity |
| Deployment configuration | `.github/workflows/render-blueprint-validation.yml` | bounded Render blueprint/schema/zero-cost configuration checks | live deployment, production readiness, unrelated Product acceptance |
| Research / benchmark | `.github/workflows/local-model-ab-benchmark.yml` | benchmark harness, pinned research environment, comparison evidence | ordinary full repository gate, required Product acceptance |

The filenames `windows-validation.yml` and `postgres-persistence-validation.yml` contain historical naming. Filename cleanup is secondary to responsibility correctness and must not be performed in a way that breaks required contexts or active concurrent work.

## Current browser exception

`m7-browser-lifecycle-validation.yml` predates this contract and currently combines the repository gate, a broad PostgreSQL regression surface, and real-browser lifecycle acceptance. A separate browser effort is already responsible for that surface, so this Work Item does not rewrite it.

Until that dedicated cleanup occurs:

- the file is the only permitted specialist exception to the no-full-repository-gate rule;
- `test/ci-workflow-scope.test.ts` pins its exact current Git blob SHA;
- any M7 workflow change therefore requires an explicit guard update rather than silently expanding the exception;
- the future cleanup should replace the milestone-specific identity with a durable Browser/E2E responsibility and then remove the exception.

The pinned exception is a concurrency/drift control, not approval of the current catch-all architecture.

## Required-status state

The Main ruleset now requires exactly one durable GitHub Actions context:

- `Core PR validation`

The historical contexts `Windows platform-neutral validation` and `Windows bounded prototype validation` were used only during migration and are retired. Their zero-run compatibility jobs/files have been removed from the repository. Reintroducing either historical required identity is CI-architecture regression unless a new, explicit control-plane migration establishes a bounded temporary need.

Required-status configuration remains external repository control-plane state. Repository tests can enforce the absence of retired compatibility shims and the presence of the durable Core job, but they cannot prove the live ruleset configuration by themselves. Any readiness claim that depends on the required-status set must therefore re-read the live ruleset.

## Executable anti-drift guard

`test/ci-workflow-scope.test.ts` is part of the ordinary `npm test` / `npm run check` path. It must fail when the repository regresses on the invariants it can observe directly, including:

- loss of the durable `Core PR validation` context;
- more than one executable full repository gate outside the frozen M7 exception;
- a specialized workflow acquiring Product/milestone/readiness PASS claims;
- reintroduction of the retired historical required-context compatibility shims;
- a new milestone-named CI workflow identity outside the explicit M7 exception;
- any unacknowledged change to the frozen M7 workflow.

Changing the guard is allowed when the architecture intentionally changes. Such a change must be reviewed as an architecture-contract change, not used merely to make a newly drifting workflow pass.

## Adding or changing a workflow

Before adding a workflow or expanding an existing one, answer:

1. Which durable responsibility owns the evidence?
2. Why can the evidence not live in an existing lane?
3. Is the execution surface itself material to the claim, or merely where a test happened to run?
4. Is the workflow required for every PR, conditionally relevant integration evidence, deep regression, or manual/research evidence?
5. Does the change duplicate `npm run check` or another lane's responsibility?
6. Does any output wording imply Product or milestone acceptance beyond the exercised surface?
7. Does the required-status name remain meaningful after the current milestone/platform/provider is gone?

If those questions do not justify a distinct durable responsibility, do not create another permanent lane.
