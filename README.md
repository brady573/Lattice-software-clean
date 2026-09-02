# Lattice Software

Fast, zero-cost Lattice prototype proving the V36 truth-centered decision architecture with deterministic offline evidence, a Product-owned provider-neutral model boundary, durable asynchronous control components, and a fidelity-bound Solandra presentation layer.

For a concise current implementation map before opening source, read `docs/design/Lattice-System-Architecture.md`.

## Prototype slice

The current slice accepts a normal-language goal plus explicit priorities and hard constraints, evaluates deterministic evidence through the V36 truth layer, persists authoritative truth and decision state when PostgreSQL is configured, creates an authoritative `StructuredDecision`, and has Solandra explain that decision without changing it.

The included demonstration intentionally contains a candidate with the highest raw preference score that loses because it violates a hard constraint.

No paid provider, queue service, or cloud service is required for the offline prototype.

## Solandra offline consultation UI

The Owner-approved offline-prototype Solandra design is installed under `docs/design/solandra/`.

The deployed UI slice is deliberately bounded to the default deterministic decision fixture. Start the application and open:

```text
http://127.0.0.1:3000/
```

The browser does **not** interpret arbitrary natural-language intent, choose a winner, infer eligibility, or adjudicate evidence. It calls the prototype-only server endpoint:

```text
POST /api/v1/prototype/consultations/default
```

The server executes the existing structured default decision request through persisted V36 → StructuredDecision → Solandra state and returns a typed consultation projection. The client renders only that licensed projection.

General conversational submission remains visibly disabled until the Product has a qualified natural-language intent/version contract. This UI slice does not activate live research or a live model provider.

## Requirements

- Node.js 24 LTS
- npm 11+
- PostgreSQL 18 only when exercising the durable development path

## Run locally

Install locked dependencies and run the repository gate:

```bash
npm ci
npm run check
```

Start the default development process:

```bash
npm run dev
```

The API listens on `127.0.0.1:3000` by default. Without `DATABASE_URL`, development mode uses the in-memory Run store. When `DATABASE_URL` is supplied, the application uses the PostgreSQL Run store. `LATTICE_DEPLOYMENT_MODE=durable` fails closed unless `DATABASE_URL` is configured.

The canonical prototype truth mode is `LATTICE_TRUTH_MODE=v36-offline`. Live-provider truth research remains intentionally dormant during the offline stage.

### Zero-cost local model provider

Development mode can use a locally running OpenAI-compatible model server, such as a local Qwen model exposed by Ollama, without a paid model API. The route is explicitly classified as `LOCAL_OFFLINE` and `PINNED`; it remains a non-authoritative model capability and does not activate external live-provider routing or bypass V36.

The exact `qwen3:4b-instruct` + Ollama `0.33.2` combination has been qualified on canonical `main @ 80d50a3cf06f60fbd0c5deb6e00411fe7f21137a` for the bounded local development/model-contract role: the direct `/v1/chat/completions` probe returned the requested licensed output and the deterministic local-model suite passed 18/18 attempts. See `docs/implementation/M9-local-offline-qwen-qualification.md` for exact provenance and limitations.

For an Ollama-compatible endpoint on its default local port, the tested development configuration is:

```bash
LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1
LATTICE_LOCAL_MODEL_PROVIDER_MODEL=qwen3:4b-instruct
npm run dev
```

Other exact installed model tags may be used for experiments, but qualification does not transfer by model-family name alone. In particular, the thinking-specific `qwen3:4b` artifact tested during qualification did not satisfy the deterministic licensed-output contract under the tested runtime; do not substitute it for `qwen3:4b-instruct` and assume equivalent behavior.

The local provider endpoint is development-only and must resolve to loopback. Legacy `LATTICE_MODEL_SIMULATOR_BASE_URL` / `LATTICE_MODEL_SIMULATOR_MODEL` variables remain supported for compatibility, but do not configure the legacy and first-class variable families together.

The provider-independent local model benchmark can exercise the same local OpenAI-compatible endpoint:

```bash
npm run benchmark:local-model -- run \
  --base-url http://127.0.0.1:11434/v1 \
  --model qwen3:4b-instruct \
  --output local-model-benchmark.json
```

A successful local-model benchmark is development evidence for the exact model/runtime tested. It is not live-provider qualification, Product acceptance, V36 truth, or production readiness. This local/offline qualification does not satisfy M9-4, which remains the separate pinned zero-cost **live** provider qualification Work Item.

M8-A establishes a provider-neutral request security context whose Product-facing contract is only `AuthenticatedSubject { subjectId }`. Development defaults to the explicit local fixture mode `LATTICE_AUTHENTICATION_MODE=development-fixture` with `LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID=fixture-user`; the fixture subject can be changed for local/test execution. `LATTICE_AUTHENTICATION_MODE=required` removes that fallback and authoritative `/api/v1/*` requests fail closed with `401 AUTHENTICATION_REQUIRED` until runtime composition injects an authenticated-subject resolver. Provider tokens, cookies, JWT claims, OAuth schemas, and other provider-specific identity mechanisms are intentionally outside this Product contract.

Create a legacy synchronous fixture run:

```bash
curl -sS -X POST http://127.0.0.1:3000/runs \
  -H 'content-type: application/json' \
  -d '{
    "goal":"Choose an option under $1300 with at least 12 hours of battery life, prioritizing performance.",
    "hardConstraints":[
      {"criterion":"price","operator":"lte","value":1300},
      {"criterion":"batteryHours","operator":"gte","value":12}
    ],
    "priorities":[{"criterion":"performance","weight":1}]
  }'
```

Expected decision: `nova-air`. `atlas-pro` has a higher raw performance score but is ineligible because its price exceeds the hard limit.

The versioned message API has an atomic asynchronous Run-acceptance boundary, durable idempotency, polling/result surfaces, durable cancellation, and an at-least-once Run-worker execution boundary. Durable Execution Runtime composition, the V36 continuation handshake, conversation/progress continuity, and M8 subject/privacy boundaries have all been implemented in their accepted milestone scopes; exact validation provenance remains revision-bound. See `docs/ROADMAP.md` for the current execution view.

## Durable development path

Apply migrations explicitly with:

```bash
DATABASE_URL=postgresql://... npm run db:migrate
```

For durable execution, configure at minimum:

```bash
LATTICE_DEPLOYMENT_MODE=durable
LATTICE_TRUTH_MODE=v36-offline
LATTICE_AUTHENTICATION_MODE=required
DATABASE_URL=postgresql://...
LATTICE_AUTO_MIGRATE=false
npm start
```

Durable mode rejects development-fixture authentication. No production identity provider is selected by M8-A, so the repository startup composition intentionally has no provider-derived resolver and therefore fails closed on authoritative authenticated API requests. A separately qualified later integration can map validated provider identity into the stable `AuthenticatedSubject.subjectId` boundary without exposing provider schemas to Intent Authority, V36, Decision Engine, or Solandra.

The repository PostgreSQL validation lane exercises restart survival, Run epoch/CAS behavior, transactional outbox persistence, V36 truth persistence, durable orchestration, asynchronous API handoff/idempotency, cancellation, conversation/decision-plan continuity, subject isolation/deletion behavior, and rollback of partial truth-state writes on the supported development PostgreSQL surface. This development validation is not production database or production-readiness evidence.

## Current boundaries

- **Lattice Intent Authority** owns canonical versioned USER intent. `DecisionPlan` is a durable exact IntentVersion-to-Run planning binding, not a separate Product authority.
- **Lattice Execution Runtime** owns durable Run lifecycle, coordination, cancellation, recovery, and research execution. The separated durable API/Run-worker/Research-worker composition established through M3 remains operational infrastructure, not truth or decision authority.
- **V36 Truth Core** is the protected epistemic authority for material external-world factual evidence used by authoritative decisions. The durable V36 research continuation contract established through M4 preserves V36-only admission/sufficiency authority even when Runtime workers execute research.
- The current default V36 truth pipeline remains deterministic/offline. Live-provider promotion is separately governed by M9 and is not implied by local model or provider-contract support.
- `src/model/` is the non-authoritative **Lattice Model Gateway**. Model/provider output is proposal, interpretation, or rendering material until the owning Product authority accepts it under its own contract.
- **Lattice Decision Engine** owns authoritative eligibility, trade-off, frontier, selection, and `StructuredDecision` semantics from bound planning material plus V36-admitted evidence.
- **Solandra Experience** is downstream of intent/truth/decision authority. Its semantic presentation is derived from authoritative Product state and must not silently create USER intent, V36 truth, eligibility, ranking, or winner identity.
- M7 durable Conversation/USER-message/continuity/reconnect behavior and M8 authenticated-subject ownership, derived-graph isolation, subject-scoped idempotency, explicit USER-controlled preference continuity, historical immutability, historical-fact non-reuse, and deletion-state enforcement are implemented in their accepted scopes. Generalized memory, retention duration, and purge execution remain outside those acceptance claims.
- PostgreSQL-backed Run/truth/decision/intent/conversation/planning/preference persistence exists for the durable development runtime; in-memory storage remains available for local fixture development.
- Production deployment, production database mutation, live-provider acceptance, paid infrastructure, and production readiness are not implied by repository state or development validation.
- Browser/usability/accessibility acceptance remains separate from repository build/test success; see `docs/design/solandra/ACCEPTANCE.md` for the Solandra UI acceptance surface.
- `package-lock.json` is committed and validated on the approved Node 24/npm 11 surface; use `npm ci` so local and CI dependency resolution follows that lockfile.

## Governing Product design and specifications

The canonical living Product design and forward 1.0 roadmap is `docs/design/Lattice-Living-Software-Design-to-1.0.md`. Its item-level status vocabulary is controlling except where a later explicit Owner decision supersedes an older item for the same bounded scope.

For the **current structural implementation map**, including subsystem ownership, call direction, authoritative/durable/derived state, trust boundaries, and the `Intent Authority → DecisionPlan → Run → V36 → Decision Engine → Solandra` composition, read `docs/design/Lattice-System-Architecture.md`.

The first Product-design filter is `docs/design/Lattice-Foundational-Design-Principle.md`; canonical system vocabulary is defined by `docs/design/Lattice-System-Registry-and-Naming.md`; and cross-cutting semantic ownership constraints are protected by `docs/design/Lattice-Architecture-Integrity.md`. The Owner-approved offline-prototype Solandra UI design/approval is installed under `docs/design/solandra/`.

`docs/specifications/SPEC-1-Lattice-Rebuilt/` remains the detailed qualified implementation specification for confirmed contracts that the living design has not explicitly superseded. The protected V36 truth-core revision and machine-readable proof obligations remain under `docs/specifications/V36-Truth-Layer/`; `claim-proof-contracts.json` is the exact proof-obligation contract.

For the current execution view of the living roadmap, see `docs/ROADMAP.md`.
