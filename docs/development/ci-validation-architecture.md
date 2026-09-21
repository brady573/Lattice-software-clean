# CI Validation Architecture

## Purpose

Lattice is a single-owner hobby project. CI exists to catch meaningful regressions without turning the repository into an operations project of its own.

This repository is public, so ordinary automated validation uses standard GitHub-hosted runners. The Owner's PC and Android device are development machines, not public pull-request runners.

## Current validation lanes

| Responsibility | Workflow | Hosted surface | Owns |
|---|---|---|---|
| Core validation | `.github/workflows/core-validation.yml` | `windows-latest` | Node/runtime preflight, locked dependency install, one `npm run check` |
| PostgreSQL integration | `.github/workflows/postgres-integration-validation.yml` | `ubuntu-latest` + digest-pinned PostgreSQL 18.6 service | database-dependent integration behavior plus immutable image identity and runtime PostgreSQL version evidence |
| Deterministic browser lifecycle | `.github/workflows/browser-lifecycle-validation.yml` | `ubuntu-latest` + the same digest-pinned PostgreSQL 18.6 service + hosted Chrome/Chromium | deterministic real-browser lifecycle behavior independent of live model-provider availability |
| Live Solandra cognition qualification | `.github/workflows/live-solandra-cognition-validation.yml` | `ubuntu-latest` + configured Groq/OpenAI model route | bounded real-provider/model cognition qualification for materially relevant cognition/runtime changes |
| Render blueprint | `.github/workflows/render-blueprint-validation.yml` | `ubuntu-latest` | static zero-cost `render.yaml` contract |
| Deployed Product functional validation | `.github/workflows/deployed-functional-validation.yml` | `ubuntu-latest` against an approved deployed Product target | deployment-event qualification plus deployed Product-surface journeys; automatic preview evidence is revision-bound, while manual runs without independent deployment proof are diagnostic only |

The local-model A/B benchmark remains available through the repository tooling, but it is intentionally not a GitHub Actions workflow. GPU/model experiments run manually on hardware the Owner chooses rather than on public pull-request infrastructure.

## Invariants

1. `Core PR validation` is the only ordinary workflow job that runs the complete `npm run check` gate.
2. Specialist lanes execute only the checks required for their distinct surface; they do not duplicate the full repository gate.
3. Public pull-request workflows must not use `self-hosted` runners or Owner-machine labels.
4. Database CI uses an isolated, digest-pinned PostgreSQL 18.6 service container and also verifies the running server version.
5. Deterministic Browser Lifecycle does not depend on Groq credentials, quota, latency, or provider availability.
6. Live Solandra cognition qualification is separate specialist evidence. Its triggers are limited to materially relevant model/cognition/runtime surfaces, and the shared Groq/model qualification scope is serialized repository-wide.
7. Automatic deployed Product validation is eligible only after approved preview-target, full deployment-SHA, open-PR, and current-PR-head checks pass. The same revision relationship is revalidated immediately before the Product journey.
8. A manual deployed Product run with no independently verified deployed revision is classified `UNBOUND_DIAGNOSTIC`; `PRODUCT_EXPECTED_DEPLOYED_SHA` remains empty and the run is not candidate validation.
9. Deployment event qualification and actual deployed Product validation are distinct job identities. Ineligible deployment events record that Product validation was skipped/not requested rather than presenting a successful Product-validation job.
10. Workflow success is bounded evidence for the exact revision and exercised surface when the lane actually establishes that binding. It is not Product acceptance, production readiness, or deployment evidence beyond the lane's explicit contract.
11. Live provider qualification and deployed Product validation are specialist/Product-surface evidence, not Core. Neither becomes Product PASS merely because its workflow succeeds, and specialist lanes are not automatically required merge checks.
12. External GitHub Actions remain pinned to qualified full commit SHAs, and checkout does not persist repository credentials.
13. Standard GitHub-hosted runners are used only while they remain zero-cost for this public repository. Paid runner capacity or billable CI services require explicit Owner authorization.
14. Add another workflow only when it protects a genuinely distinct execution surface that cannot reasonably live in an existing lane.

## Retired workflow structure

The clean repository does not carry forward the prior self-hosted/team-era workflow structure. These workflow files remain retired:

- `windows-validation.yml`
- `postgres-persistence-validation.yml`
- `m7-browser-lifecycle-validation.yml`
- `local-model-ab-benchmark.yml`
- `android-prototype-validation.yml`

Implementation identifiers inside existing test or browser tooling may retain historical names until changing them has Product or maintenance value. They do not define CI architecture.

## Branch protection and required checks

Workflow files describe validation behavior; they do not prove that Actions are enabled or that a check is required by GitHub branch protection.

The repository currently has no ruleset. Branch-protection changes are outside this CI slice. If branch protection is later separately Owner-authorized, prefer the smallest useful rule: require the durable `Core PR validation` context. PostgreSQL, deterministic browser, Render, deployed Product, and live-provider lanes remain conditional specialist evidence unless a separate Owner decision changes that policy.

## Changing CI

Before expanding CI, answer:

1. What user- or Product-relevant regression would this catch?
2. Which existing lane owns the closest responsibility?
3. Does the execution surface itself matter to the claim?
4. Can a focused repository test replace another workflow?
5. Does the proposed automation remain zero-cost and safe for a public repository?

If the answers do not justify another durable lane, keep the check local or fold it into an existing lane.
