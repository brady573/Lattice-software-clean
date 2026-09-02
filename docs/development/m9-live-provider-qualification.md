# M9 live-provider qualification

Status: development/research tooling for M9-4. A qualification report is provider/model-route evidence only; it does not establish Lattice Product acceptance, V36 truth, routing policy, production readiness, or provider authority.

## Current bounded candidates

M9-4 compares pinned `LIVE_DIRECT` development routes over the same provider-neutral benchmark harness.

### Groq Free Plan

- provider: `groq`
- model: `openai/gpt-oss-20b`
- base URL: `https://api.groq.com/openai/v1`
- route mode: `PINNED`
- credential slot: `GROQ_API_KEY`
- route proof: `https://console.groq.com/docs/model/openai/gpt-oss-20b`
- route-specific control: `reasoning_effort=low`

Repeated live Groq runs established direct connectivity but failed the unchanged behavioral oracle, with observed pass rates roughly 55–72% and occasional HTTP 429 responses. Those runs remain qualification failures.

### NVIDIA hosted NIM — qualified development route

- provider: `nvidia`
- model: `nvidia/nemotron-3.5-lightning-30b-a3b`
- base URL: `https://integrate.api.nvidia.com/v1`
- route mode: `PINNED`
- execution class: `LIVE_DIRECT`
- credential slot: `NVIDIA_API_KEY`
- route proof: `https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b`
- request controls: thinking disabled; strict exact-output contract; JSON mode only for `structured-action-contract`; named selection of the sole supplied tool; minimum completion tokens 64

The exact successful qualification is recorded in `docs/development/m9-4-nvidia-nemotron-3.5-lightning-qualification-2026-08-31.md`.

Earlier NVIDIA candidates remain negative evidence and are not retried:

- `meta/llama-3.1-8b-instruct`: authenticated model discovery succeeded, but all live chat attempts returned HTTP 410; the hosted route was treated as retired.
- `mistralai/mistral-nemotron`: authenticated discovery succeeded, but the route produced repeated 5xx/timeouts and its minimal documented smoke request timed out from the Render qualification surface.

## Execution boundary

The provider-neutral runner:

- requires a non-loopback HTTPS base URL for live qualification;
- accepts only `PINNED` route mode and `LIVE_BROKERED` or `LIVE_DIRECT` execution classes;
- requires broker identity plus immutable mapping revision for `LIVE_BROKERED` and broker omission for `LIVE_DIRECT`;
- reads credentials only from named environment variables and never accepts credential values on the command line;
- records exact source revision and bounded transport/request metadata without secret values;
- writes a report even when scenarios fail, and failed scenarios remain qualification failures;
- supports deterministic simulation of 429, 5xx/unavailable, malformed JSON, and timeout behavior;
- supports bounded diagnostic subsets that are explicitly non-qualification evidence;
- preserves the shared benchmark oracle instead of normalizing provider output into success.

For NVIDIA, the Render wrapper additionally performs a response-model identity preflight. A qualification fails closed unless the provider returns an explicit `model` field exactly matching the pinned model. The observed response-model identity is persisted in `responseModelEvidence`.

## Render execution surface

M9-4 uses the sibling free Render web service `lattice-m9-live-provider-qualification`; `lattice-main-blackbox-probes` remains dedicated to canonical Product blackbox probes.

The qualification service uses:

- repository: `brady573/Lattice-Software`
- branch: `m9-4-live-provider-qualification`
- plan: free
- auto deploy: off
- build: `npm ci --no-audit --no-fund && npm run check`
- start: `npm run qualify:live-provider:render`
- `RENDER=true`
- `M9_PROVIDER_CANDIDATE=groq` or `nvidia`
- the matching provider credential slot

The wrapper binds Render's `PORT` immediately and exposes a bounded `RUNNING` state while qualification is in progress. `RUNNING` is not qualification success. The same process later exposes bounded `PASS` or `FAIL` state, preventing Render port-scan termination from automatically replaying provider work.

Do not create a Render cron job for this Work Item. Do not enable paid provider infrastructure under M9-4.

## Deterministic preflight

Before a changed live qualification, the exact candidate revision must pass:

```powershell
npm ci --no-audit --no-fund
npm run check
```

Do not repeat unchanged live qualification merely for a newer timestamp. Reuse matching evidence unless source, suite, route, provider/model, request controls, relevant provider policy, or execution environment materially changes.

## Required evidence packet

A valid M9-4 qualification packet keeps together:

- exact executed Lattice revision;
- benchmark suite ID/path;
- base URL, execution class, and route mode;
- requested and independently observed provider/model identity where provider-specific qualification is claimed;
- provider route-proof URI and timestamps;
- exact request controls;
- exact qualification summary and Render deploy identity;
- deterministic preflight result and failure-simulation coverage;
- current zero-cost/free-endpoint evidence and its observation date;
- current provider retention/training/data-handling evidence and its observation date;
- observed rate-limit behavior plus bounded 429, timeout, 5xx/unavailable, malformed-output, and cancellation evidence.

A successful response is insufficient when actual-route provenance is ambiguous. A pass rate is insufficient when the experiment's cost/data-handling boundary is unknown. Qualification does not authorize Product routing or production use.

## Current qualification status

NVIDIA `nvidia/nemotron-3.5-lightning-30b-a3b` has a bounded M9-4 development-route qualification on exact executed revision `be682b421bac0c051658c89bc657df7ea4bebda0`: 18/18 behavioral attempts passed, actual response-model identity matched the pinned route, and the exact Render preflight passed 377 tests with zero failures.

NVIDIA currently labels this model's hosted path a `Free Endpoint` and NVIDIA Developer Program material describes hosted NIM endpoints as free for prototyping/development. This qualification does not assert a production entitlement, indefinite quota, or account-specific remaining allowance.

Provider data handling remains an external boundary. Current NVIDIA API Trial Terms state that, unless otherwise disclosed, user/generated content is not stored or used after an API session, with exceptions including security/fraud/abuse logging and specified services. Lattice therefore limits this qualified hosted route to synthetic/non-sensitive development input; no confidential, personal, production, or otherwise sensitive Product data is authorized by this qualification.

Observed live rate limiting on the successful 18-attempt run was 0/18. Exact account/model rate limits and remaining allowance remain external/account-specific facts and are not converted to zero or unlimited.

No provider has been activated as Product routing policy, no paid resource was enabled, and OD-005 automatic routing/failover remains unresolved.
