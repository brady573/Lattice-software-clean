# Offline model simulator qualification reference

Status: development-only integration reference for **Prototype M1 - V7 Offline LLM Simulation Lab**.

V7 is an Owner-designated external prototype-stage artifact. It is not Lattice Product code, is not vendored into Product source, and is not a production or runtime dependency merely because it is recorded as M1. Forward Product roadmap execution begins with M2 - Durable runtime composition; this bounded model-boundary slice does not satisfy M2 or any other roadmap milestone by itself.

Lattice Product owns the canonical `src/model/` contract. The V7 Simulation Lab remains an external qualification surface used to exercise provider-neutral/model-facing boundaries before any separately qualified live-provider promotion.

Reviewed artifact identity:

- package: `lattice-llm-simulation-lab`
- package version: `1.7.0-research`
- deployable npm tarball SHA-256:
  `2233295ca35bc3e59d3f944a850d0ceb770b6009b8ba86e3b8dc6f5e40d3871f`
- polished research/deployment bundle SHA-256:
  `673aea1363458144cdab1961615ac640777f0c2cedb7ef10e3fd3ffc1f23df7e`

The simulator is used only as an external/offline contract target. The first Product adapter is
restricted to loopback endpoints and uses Node's built-in `fetch`; no provider SDK, cloud
credential, paid provider, production resource, or model weight is introduced by this slice.
The runtime also rejects simulator configuration when `LATTICE_DEPLOYMENT_MODE=durable`, so
this prototype conversation surface cannot be enabled on the durable application path.

V7 is not Product authority. Its standalone validation applies only to the identified external artifact. Its evolutionary resource values are not Product defaults, and its standalone test results do not transfer to Lattice Product validation, V36 acceptance, real-model reliability, production sizing, or production readiness.

Example development target:

```text
Lattice ModelRuntime
  -> OpenAiCompatibleModelProvider
  -> http://127.0.0.1:<ephemeral>/v1/chat/completions
  -> V7 fixture / chaos / synthetic-model mode
```

Product authority remains unchanged:

```text
model output = proposal / interpretation / rendering material
V36 = material external factual truth authority
StructuredDecision = eligibility / ranking / winner authority
Solandra = read-only licensed presentation
```

## Solandra conversation-test integration

The offline prototype can bind the existing Solandra composer to the Product-owned `ModelRuntime` for **transient conversation testing only**. This route does not create a durable Lattice conversation, Run, TruthSnapshot, StructuredDecision, or explanation.

For arbitrary conversational testing, run V7 in `synthetic-model` mode. Fixture mode remains appropriate for exact deterministic contract cases but will not accept arbitrary user turns.

From the V7 package directory:

```bash
LLM_SIM_MODE=synthetic-model LLM_SIM_PORT=4010 npm start
```

From the Lattice repository in a second process:

```bash
LATTICE_MODEL_SIMULATOR_BASE_URL=http://127.0.0.1:4010/v1 \
LATTICE_MODEL_SIMULATOR_MODEL=offline-prototype \
npm run dev
```

Then open `http://127.0.0.1:3000/`. The Solandra composer is enabled only when `LATTICE_MODEL_SIMULATOR_BASE_URL` is configured. The Product runtime rejects non-loopback simulator URLs and rejects simulator configuration outside development mode.

The browser transcript is intentionally transient. The prototype bounds each message to 4,000 characters and a transcript to 24 messages so conversation testing stays within the canonical model runtime request budget without silently truncating older turns. A failed unanswered turn must be retried before another turn is sent; retry uses the same logical turn identity while any draft text remains local.

Both Lattice and V7 must share the same loopback network namespace. A hosted Lattice process cannot use a simulator running on a developer workstation through `127.0.0.1`; hosted/co-located simulator deployment is a separate infrastructure and authority decision and is not enabled by this development-only slice.
