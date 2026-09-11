# Separate Render validator deployment

This document describes the bounded deployment difference for the independent Product Validator. It does not define a second Product or alternate Solandra behavior.

## Intended service

- name: `lattice-solandra-validation`
- repository: `https://github.com/brady573/Lattice-software-clean`
- branch: `main`
- region: `oregon`
- plan: `free`
- runtime: `node`
- build command: `npm ci --no-audit --no-fund && npm run build`
- start command: `npm start`
- health check: `/health`

## Required validator environment

```text
HOST=0.0.0.0
LATTICE_DEPLOYMENT_MODE=development
LATTICE_VALIDATOR_DEPLOYMENT=true
LATTICE_AUTO_MIGRATE=false
```

The validator deployment must not define:

```text
DATABASE_URL
LATTICE_OWNER_ACCESS_TOKEN
LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID
```

Runtime configuration rejects those state/identity overrides when `LATTICE_VALIDATOR_DEPLOYMENT=true`.

Provider and cognition configuration should match the canonical Owner deployment's non-Owner Product capability configuration. Provider credentials such as `GROQ_API_KEY` remain Render runtime secrets and must never be exposed to the browser or validator. The validator role does not change provider routing, prompts, cognition, Knowledge, V36, Recommendation, Decision, Action Preparation, authorization, execution, or verification semantics.

## Identity and state

Validator mode reuses the existing development fixed-subject composition and fixes it to subject `validator`. It does not create accounts, tokens, OAuth, or another identity subsystem.

Validator mode is mechanically in-memory: attaching any `DATABASE_URL` is a startup error. This prevents the service from reading or mutating the Owner PostgreSQL state. Conversation, Intent, Knowledge, Recommendation, prepared-resource, capability-authorization, and related stores therefore exist only inside the validator service process.

The Owner service remains unchanged: it continues to use durable state and the existing Owner Bearer credential mapped to subject `owner`.

## Browser session policy

The validator deployment renders the same canonical authoritative Solandra page through a thin wrapper that clears only browser conversation-recovery keys before canonical page startup. Ordinary page load or refresh therefore begins without restoring the prior conversation. Multiple turns on the same loaded page retain ordinary conversational continuity.

This deployment-only policy does not remove or modify canonical continuity APIs or durable Owner continuity.

## Deployment boundary

Do not create or mutate the Render validator service until the code/config candidate has passed repository CI and independent Steward audit.
