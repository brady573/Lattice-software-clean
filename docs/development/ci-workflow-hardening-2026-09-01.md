# CI Workflow Hardening — 2026-09-01

Status: repository-local implementation note. This document records the bounded workflow-hardening implementation and does not independently establish Product requirements, acceptance, production readiness, or Owner authorization.

The governing validation responsibilities remain in `docs/development/ci-validation-architecture.md`.

## External GitHub Actions

All external GitHub Actions are pinned by verified full commit SHA while retaining the release version as a review comment:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` — v7.0.1, Node 24 action runtime.
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` — v7.0.0, Node 24 action runtime.
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` — v7.0.1, Node 24 action runtime.

`persist-credentials: false` remains required for each checkout.

## Pull-request runner trust boundary

Core, PostgreSQL, Render, and M7 continue to validate pull requests on Windows X64. Same-repository pull requests and trusted push/manual events retain the existing `lattice-windows` runner.

A pull request whose head repository differs from the base repository is instead scheduled against the `lattice-windows-pr-ephemeral` label. That label is reserved for a clean one-job ephemeral/JIT Windows X64 self-hosted runner. If no qualifying ephemeral runner is available, the job must remain queued rather than fall back to `lattice-windows`.

This is a fail-closed repository-level mitigation for the private-fork/read-access attack path. It does not establish that the host-side runner is actually ephemeral or clean; that property must be established by runner provisioning evidence. Same-repository PR execution on the persistent development runner remains a residual trust assumption for collaborators who already have write access.

## PostgreSQL execution surface

The PostgreSQL integration and M7 browser lanes require PostgreSQL major version 18 with `server_version_num >= 180006` and `< 190000`. This admits PostgreSQL 18.6 and later patched 18.x minors while rejecting pre-18.6 PostgreSQL 18 servers.

## Render Blueprint validation

The Render lane keeps the exact approved V36 zero-cost Blueprint comparison and paid-plan/migration-automation guards. It additionally validates the actual `render.yaml` document against Render's official published JSON Schema at `https://render.com/schema/render.yaml.json`, replacing the former token-presence scan.

The workflow installs the repository's locked dependency graph with `npm ci` and requires the resolved schema validator surface to be exactly AJV 8.20.0 plus `ajv-formats` 3.0.1. It parses `render.yaml` with exact-version `yaml@2.9.0`, validates the resulting document using AJV's JSON Schema 2020-12 implementation, verifies the downloaded schema's expected Render `$id` and 2020-12 dialect, and records the observed schema SHA-256 for provenance. The schema itself is intentionally fetched live rather than digest-pinned because this lane is intended to detect incompatibility with Render's current published contract.

The generated AJV runner is written inside the checked-out repository so Node resolves the locked repository dependencies rather than runner-global packages. No additional GitHub Action or Python runtime is introduced for this validation.

Render's current CLI/API validation path requires a Render workspace and authenticated API client. The workflow therefore does not claim Render CLI semantic/conflict validation and does not add account credentials or workspace state to CI. The exact approved Blueprint comparison continues to cover this repository's bounded cross-resource V36 contract. The lane remains static/development configuration evidence only: it does not authenticate to a Render account, create resources, deploy, migrate a database, or establish production readiness.
