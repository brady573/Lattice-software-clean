# M9-4 NVIDIA NIM qualification packet — 2026-08-31

Status: **QUALIFIED FOR THE BOUNDED M9-4 DEVELOPMENT ROLE**

This record is provider/model-route qualification evidence only. It does not authorize Product routing, automatic fallback, production use, production data, paid infrastructure, V36 truth, or production readiness.

## Exact executed state

- repository: `brady573/Lattice-Software`
- branch at execution: `m9-4-live-provider-qualification`
- exact executed revision: `be682b421bac0c051658c89bc657df7ea4bebda0`
- Render service: `lattice-m9-live-provider-qualification`
- Render service ID: `srv-daaqepqd0e5s738veh40`
- Render deploy ID: `dep-daatedp5efls738u50d0`
- Render plan: free
- runtime: Node.js 24.20.0
- build command: `npm ci --no-audit --no-fund && npm run check`
- start command: `npm run qualify:live-provider:render`

The qualification wrapper bound its status port before provider work, preventing Render's web-service port scan from terminating and replaying a long-running qualification.

## Pinned route

- execution class: `LIVE_DIRECT`
- route mode: `PINNED`
- requested provider: `nvidia`
- requested model: `nvidia/nemotron-3.5-lightning-30b-a3b`
- observed actual provider: `nvidia`, established by direct use of NVIDIA's hosted API endpoint and NVIDIA route proof
- observed actual model: `nvidia/nemotron-3.5-lightning-30b-a3b`
- broker identity: none
- base URL: `https://integrate.api.nvidia.com/v1`
- route proof: `https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b`
- credential slot: `NVIDIA_API_KEY`; credential value was not recorded

### Independent response-model evidence

Before the full suite, the wrapper required a successful NVIDIA chat-completion response whose explicit `model` field exactly matched the pinned model.

Observed evidence:

- source: `CHAT_COMPLETION_RESPONSE`
- observed model: `nvidia/nemotron-3.5-lightning-30b-a3b`
- observed at: `2026-08-31T19:35:32.763Z`
- HTTP status: `200`

The full qualification report therefore recorded route provenance as `COMPLETE` rather than relying only on configured model identity.

## Request controls

- reasoning effort: none
- minimum completion tokens: 64
- thinking disabled: true
- strict output contract: true
- JSON mode scenario: `structured-action-contract`
- exact-content contract: generic stop-at-space shape constraint; expected answer values are not inserted into requests
- tool-call contract: when exactly one tool is supplied, the named tool is selected from the supplied tool schema; expected tool arguments are not inserted into requests
- repeat: 3

The benchmark suite and expected oracle remained unchanged throughout qualification.

## Deterministic preflight

Exact executed revision `be682b421bac0c051658c89bc657df7ea4bebda0` passed the Render build gate:

- tests: 377
- passed: 338
- failed: 0
- skipped: 39
- cancelled: 0

Material M9-4 deterministic coverage included:

- bearer credential redaction;
- pinned route and execution-class enforcement;
- response-model identity parsing;
- strict output controls without expected-answer injection;
- diagnostic subsets explicitly marked non-qualification;
- simulated HTTP 429 fail-closed behavior;
- simulated 5xx/unavailable fail-closed behavior;
- malformed provider JSON fail-closed behavior;
- timeout fail-closed behavior;
- canonical cancellation versus timeout distinction;
- immediate/stable Render status-port binding through pre-qualification failure.

## Full behavioral qualification

Suite: `lattice-local-model-agent-v1`

Completed: `2026-08-31T19:36:33.128Z`

Result:

- attempts: 18
- passes: 18
- failures: 0
- pass rate: 1.0
- observed HTTP 429: 0
- observed unavailable/5xx: 0
- observed timeouts: 0
- observed malformed responses: 0

The six benchmark scenarios each ran three times. No diagnostic subset was active.

## Cost / availability evidence

Observed on 2026-08-31:

- NVIDIA's model catalog labels `nvidia/nemotron-3.5-lightning-30b-a3b` as a `Free Endpoint` and presents it as a free API endpoint for prototyping.
- NVIDIA Developer Program material describes hosted NIM API endpoints as free for prototyping/development.
- The Render qualification service uses Render's free plan.
- No paid provider or paid infrastructure activation was performed by this Work Item.

This record does not assert an unlimited or perpetual entitlement. Account/model rate limits and remaining allowance are provider/account-specific external facts. The successful live run observed no 429 responses.

## Provider data-handling boundary

Observed on 2026-08-31 from NVIDIA API Trial Terms: unless otherwise disclosed for a particular service, NVIDIA states that User Content and Generated Content are not stored or used after each API service session, with stated exceptions including security/fraud/abuse logging and certain separately identified services.

Because the hosted endpoint is a development/trial surface and provider terms may change, this M9-4 qualification authorizes only **synthetic/non-sensitive development inputs** for this route. It does not authorize confidential, personal, production, or otherwise sensitive Lattice Product data. Production provider/data-class policy remains outside M9-4.

## Negative evidence retained

- Groq `openai/gpt-oss-20b`: direct connectivity was established, but repeated unchanged-suite runs remained below the qualification oracle (roughly 55–72% pass rate, with occasional 429 responses).
- NVIDIA `meta/llama-3.1-8b-instruct`: model discovery authenticated successfully but live chat requests returned HTTP 410; treated as retired/unusable.
- NVIDIA `mistralai/mistral-nemotron`: discovery authenticated successfully, but full and minimal requests produced 5xx/timeouts; treated as unsuitable for this role from the tested Render surface.

These failures are not normalized into success and were not blindly retried after their discriminating evidence was established.

## Qualification conclusion

`nvidia/nemotron-3.5-lightning-30b-a3b` is qualified for the bounded M9-4 **hosted, zero-cost development provider role using synthetic/non-sensitive inputs** under the exact route/request controls and executed revision above.

This qualification does **not**:

- activate the provider in Product runtime;
- authorize automatic routing or failover;
- resolve OD-005;
- authorize production use or production data;
- authorize paid usage;
- establish V36 truth or Decision Engine authority;
- establish overall Lattice Product acceptance or production readiness.
