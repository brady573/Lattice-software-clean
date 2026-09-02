# M9 local-offline Qwen development qualification

Status: **QUALIFIED DEVELOPMENT SUPPORT EVIDENCE / NOT LIVE-PROVIDER ACCEPTANCE**

Date: **2026-08-30**

Canonical Product revision under test: `main @ 80d50a3cf06f60fbd0c5deb6e00411fe7f21137a`, tree `48b03ad3d5165d64bfb66c8a60d77c870d0f89d9`.

## Purpose

Record the exact evidence establishing a permanent zero-API-cost local model route for Lattice development and M9 testing without promoting that route into live-provider, V36, routing, or production authority.

This record is implementation/validation provenance. It does not redefine `docs/design/M9-Live-Provider-Promotion-Architecture.md`, resolve OD-005, complete M9-4, or authorize production use.

## Qualified local route

- Execution class: `LOCAL_OFFLINE`
- Route mode: `PINNED`
- Local runtime: Ollama `0.33.2`
- OpenAI-compatible endpoint: `http://127.0.0.1:11434/v1`
- Qualified model tag: `qwen3:4b-instruct`
- Role: bounded local development / deterministic model-contract and tool-proposal testing
- Cost class: local / zero API cost

The route remains non-authoritative. Model output is proposal/interpretation material under the existing Lattice Model Gateway and Product authority chain.

## Executed evidence

### Repository gate

On the exact canonical revision above, the local repository gate completed with:

- tests: 355
- passed: 316
- failed: 0
- skipped: 39

### Direct endpoint probe

`qwen3:4b-instruct` returned the exact requested content `LATTICE_INSTRUCT_OK` through Ollama's `/v1/chat/completions` interface.

This established that the exact model/runtime combination produced licensed assistant content through the same OpenAI-compatible transport family used by Lattice.

### Deterministic local-model benchmark

Command surface:

```powershell
npm run benchmark:local-model -- run `
  --base-url http://127.0.0.1:11434/v1 `
  --model qwen3:4b-instruct `
  --output local-model-benchmark-instruct.json
```

Observed summary:

```json
{"attempts":18,"passes":18,"failures":0,"passRate":1,"meanLatencyMs":97.79,"p50LatencyMs":68.1,"p95LatencyMs":192.62}
```

The six deterministic benchmark scenarios, repeated three times each, include evidence-boundary classification, discriminating-probe selection, structured action JSON, source provenance selection, untrusted-web instruction handling, and an OpenAI-compatible `web_search` tool-call proposal contract.

The 18/18 result qualifies this exact local model/runtime combination only for the bounded development/testing role exercised by the suite. It is not general model superiority or Product acceptance.

## Disqualified model variant for this role

The initially installed `qwen3:4b` artifact identified as model ID `359d7dd4bcda` behaved as a thinking-specific variant on the tested Ollama runtime.

Observed behavior:

- CLI inference could eventually emit the requested answer but exposed reasoning behavior.
- the deterministic `/v1` benchmark produced 0/18 passes with empty licensed normal content under tight output bounds.
- a native Ollama `/api/chat` probe with `think=false` still returned reasoning text inside `message.content` before the requested final answer.

A proposed transport-control workaround was tested in PR #147. Its repository CI was green, but the exact local benchmark remained 0/18, disproving the proposed repair for the observed Product-relevant behavior. PR #147 was therefore closed unmerged.

Do not treat the thinking-specific `qwen3:4b` result as evidence that the Lattice provider seam failed. The `qwen3:4b-instruct` result demonstrates the existing canonical OpenAI-compatible local path works for the bounded role when paired with the appropriate model variant.

## M9 boundary

This qualification provides permanent local/offline support infrastructure for M9 work and may be reused to reduce external-provider cost and diagnostic churn.

It does **not** satisfy M9-4, whose architecture objective is qualification of a pinned zero-cost **live** provider/model route. It also does not establish:

- `LIVE_BROKERED` or `LIVE_DIRECT` behavior;
- external networking, provider quota/rate, retention/training, or route-provenance evidence;
- M9-5 live research through durable Runtime and V36;
- OD-005 routing/failover policy;
- M9-7 integrated Product acceptance;
- production deployment or production readiness.

## Development default

For bounded local M9/model testing, prefer:

```powershell
$env:LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL="http://127.0.0.1:11434/v1"
$env:LATTICE_LOCAL_MODEL_PROVIDER_MODEL="qwen3:4b-instruct"
```

Before transferring this qualification to another machine, model tag, Ollama version, Lattice revision, or benchmark revision, rerun the smallest discriminating probe required for the changed surface. Do not infer cross-revision or cross-runtime equivalence from the model name alone.
