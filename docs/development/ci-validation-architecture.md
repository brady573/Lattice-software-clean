# CI Validation Architecture

## Purpose

Lattice is a single-owner hobby project. CI exists to catch meaningful regressions without turning the repository into an operations project of its own.

This repository is public, so ordinary automated validation uses standard GitHub-hosted runners. The Owner's PC and Android device are development machines, not public pull-request runners.

## Current validation lanes

| Responsibility | Workflow | Hosted surface | Owns |
|---|---|---|---|
| Core validation | `.github/workflows/core-validation.yml` | `windows-latest` | Node/runtime preflight, locked dependency install, one `npm run check` |
| PostgreSQL integration | `.github/workflows/postgres-integration-validation.yml` | `ubuntu-latest` + isolated `postgres:18.6` service | database-dependent integration behavior |
| Browser lifecycle | `.github/workflows/browser-lifecycle-validation.yml` | `ubuntu-latest` + isolated `postgres:18.6` service + hosted Chrome/Chromium | real-browser lifecycle behavior |
| Render blueprint | `.github/workflows/render-blueprint-validation.yml` | `ubuntu-latest` | static zero-cost `render.yaml` contract |

The local-model A/B benchmark remains available through the repository tooling, but it is intentionally not a GitHub Actions workflow. GPU/model experiments run manually on hardware the Owner chooses rather than on public pull-request infrastructure.

## Invariants

1. `Core PR validation` is the only ordinary workflow job that runs the complete `npm run check` gate.
2. Specialist lanes execute only the checks required for their distinct surface; they do not duplicate the full repository gate.
3. Public pull-request workflows must not use `self-hosted` runners or Owner-machine labels.
4. Database CI uses an isolated PostgreSQL service container rather than a persistent development database.
5. Workflow success is bounded evidence for the exact revision and exercised surface. It is not Product acceptance, production readiness, or deployment evidence.
6. External GitHub Actions remain pinned to qualified full commit SHAs, and checkout does not persist repository credentials.
7. Standard GitHub-hosted runners are used only while they remain zero-cost for this public repository. Paid runner capacity or billable CI services require explicit Owner authorization.
8. Add another workflow only when it protects a genuinely distinct execution surface that cannot reasonably live in an existing lane.

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

The fresh clean repository starts without an inherited ruleset. If branch protection is added after the hosted workflows have demonstrated stable behavior, prefer the smallest useful rule: require the durable `Core PR validation` context. PostgreSQL, browser, and Render lanes should remain conditional specialist evidence unless a concrete reliability problem justifies making one required.

## Changing CI

Before expanding CI, answer:

1. What user- or Product-relevant regression would this catch?
2. Which existing lane owns the closest responsibility?
3. Does the execution surface itself matter to the claim?
4. Can a focused repository test replace another workflow?
5. Does the proposed automation remain zero-cost and safe for a public repository?

If the answers do not justify another durable lane, keep the check local or fold it into an existing lane.
