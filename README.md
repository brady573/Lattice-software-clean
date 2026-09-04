# Lattice Software

Lattice makes trustworthy knowledge and conditional decision capability easier to reach, understand, and use—while it manages the machinery.

That mission comes from [`docs/design/The-Core-Lattice-Philosophy.md`](docs/design/The-Core-Lattice-Philosophy.md), the highest Product-design authority and first filter for every Product, architecture, code, AI, workflow, UI, and validation decision. The current repository is a zero-cost implementation of that mission with Intent Authority, durable Runtime coordination, V36 truth adjudication, conditional decision support, Action Preparation, and a fidelity-bound Conversation + Composer Solandra experience.

Read the Core first. For the concise current implementation map afterward, read `docs/design/Lattice-System-Architecture.md`.

## Canonical Product slice

The canonical slice accepts a free-form conversation turn, records USER provenance through Intent Authority, evaluates trustworthy knowledge through V36, and presents a `KnowledgeOutcome` in Solandra. When consultation establishes a qualified decision need, the generalized Decision Engine may provide decision support; when explicitly requested, Lattice may prepare (but never execute) a checklist or message.

The decision fixture demonstrates qualified requirement eligibility and meaningful-difference/frontier semantics without summing incompatible raw criterion scales.

No paid provider, queue service, or cloud service is required for local Knowledge Consultation. Deterministic CI remains offline; an explicit zero-cost live development mode retrieves current external source material from Wikimedia without credentials.

## Solandra conversation UI

The Owner-approved offline-prototype Solandra design is installed under `docs/design/solandra/`.

Start the application and open:

```text
http://127.0.0.1:3000/
```

Free-form turns use `POST /api/v1/conversations/:conversationId/turns`. The server records exact USER provenance, interprets the turn against the current IntentVersion, and changes canonical intent only when the USER establishes or explicitly corrects the objective or confirms material proposed meaning. Ordinary follow-ups preserve the objective and IntentVersion while remaining non-authoritative conversational/work context for the exact Run handling that turn. V36 then supports Knowledge, conditional Decision Support, or Action Preparation at `/api/v1/runs/:runId/outcome`.

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

The default truth mode is `LATTICE_TRUTH_MODE=v36-offline`, preserving deterministic fixture execution for CI and architecture tests. To exercise real external Knowledge Consultation locally, use:

```bash
LATTICE_TRUTH_MODE=v36-live npm run dev
```

The live mode uses a replaceable, provider-neutral acquisition boundary with a credential-free Wikimedia adapter by default. Retrieved pages and excerpts enter the investigation as untrusted information. V36—not the adapter—may admit only exact, content-integrity-bound source reports. A supported source report establishes what that source says; it does not independently verify every broader claim in the report. Solandra therefore presents source identity, retrieval provenance, supporting or rejected evidence, and unresolved/conflicting material alongside the explanation.

This v0.1 path is deliberately conservative. It is extractive rather than model-synthesized, public search relevance can vary, and the default adapter does not independently corroborate a source's wider claims. Acquisition failure yields an unresolved Knowledge outcome rather than confident fallback prose. Live-network execution is opt-in and is not part of deterministic CI.

### Zero-cost local model provider

The explicit non-canonical development composition can use a locally running OpenAI-compatible model server, such as a local Qwen model exposed by Ollama, without a paid model API. Its simulator route is classified as `LOCAL_OFFLINE` and `PINNED`; it remains non-authoritative and cannot activate external live-provider routing or bypass V36. Canonical `npm run dev` never mounts simulator or Android prototype routes.

The exact `qwen3:4b-instruct` + Ollama `0.33.2` combination has been qualified on canonical `main @ 80d50a3cf06f60fbd0c5deb6e00411fe7f21137a` for the bounded local development/model-contract role: the direct `/v1/chat/completions` probe returned the requested licensed output and the deterministic local-model suite passed 18/18 attempts. See `docs/implementation/M9-local-offline-qwen-qualification.md` for exact provenance and limitations.

For an Ollama-compatible endpoint on its default local port, the tested development configuration is:

```bash
LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1
LATTICE_LOCAL_MODEL_PROVIDER_MODEL=qwen3:4b-instruct
npm run dev:prototype
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

Create a canonical free-form consultation turn after creating a conversation:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/v1/conversations/CONVERSATION_ID/turns \
  -H 'content-type: application/json' \
  -d '{
    "turnId":"turn-1",
    "message":"What should I know about preserving a sourdough starter during a short trip?"
  }'
```

Canonical runtime composition contains no built-in domain grammar, candidate fixture, criterion catalog, legacy `/runs` intake, old structured-message intake, or simulated model/Android prototype routes. Historical adapter tests use `src/legacy/legacy-test-app.ts`; simulations use explicit `src/development/` composition. A qualified interpreter, criterion catalog, and evidence composition must be supplied before a decision need can move from `UNRESOLVED` to `QUALIFIED`; material interpreted meaning remains pending until USER confirmation.

The canonical turn API has an atomic asynchronous Run-acceptance boundary, durable idempotency, polling and polymorphic outcome surfaces, durable cancellation, and an at-least-once Run-worker execution boundary. Durable Execution Runtime composition, the V36 continuation handshake, conversation/progress continuity, and M8 subject/privacy boundaries have all been implemented in their accepted milestone scopes; exact validation provenance remains revision-bound. See `docs/ROADMAP.md` for the current execution view.

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

- **Lattice Intent Authority** owns canonical versioned USER intent. `DecisionPlan` is a conditional durable exact IntentVersion-to-DecisionInput binding for qualified decision work, not universal Run planning state or a separate Product authority.
- **Lattice Execution Runtime** owns durable Run lifecycle, coordination, cancellation, recovery, and research execution. The separated durable API/Run-worker/Research-worker composition established through M3 remains operational infrastructure, not truth or decision authority.
- **V36 Truth Core** is the protected epistemic authority for external factual evidence used by Knowledge outcomes or authoritative decisions. The durable V36 research continuation contract established through M4 preserves V36-only admission/sufficiency authority even when Runtime workers execute research.
- The default V36 truth pipeline remains deterministic/offline. Explicit `v36-live` development mode adds credential-free external acquisition while preserving the same authority boundary; this Product proof is not production-provider qualification or production readiness.
- `src/model/` is the non-authoritative **Lattice Model Gateway**. Model/provider output is proposal, interpretation, or rendering material until the owning Product authority accepts it under its own contract.
- **Lattice Decision Engine** conditionally owns authoritative eligibility, typed comparison, trade-off, frontier, licensed selection, and `StructuredDecision` semantics from an exact DecisionPlan plus a decision-specific projection of V36-admitted evidence. Knowledge and non-decision Action Preparation bypass it.
- **Solandra Experience** is downstream of Product authority. Conversation carries questions, clarifications, acknowledgements, and concise explanation; Composer is the adaptive visual information surface. Neither may dictate backend behavior or silently create USER intent, V36 truth, eligibility, ranking, or winner identity.
- M7 durable Conversation/USER-message/continuity/reconnect behavior and M8 authenticated-subject ownership, derived-graph isolation, subject-scoped idempotency, explicit USER-controlled preference continuity, historical immutability, historical-fact non-reuse, and deletion-state enforcement are implemented in their accepted scopes. Generalized memory, retention duration, and purge execution remain outside those acceptance claims.
- PostgreSQL-backed Run/truth/decision/intent/conversation/planning/preference persistence exists for the durable development runtime; in-memory storage remains available for local fixture development.
- Production deployment, production database mutation, production-provider acceptance, paid infrastructure, and production readiness are not implied by repository state or development validation.
- Browser/usability/accessibility acceptance remains separate from repository build/test success; see `docs/design/solandra/ACCEPTANCE.md` for the Solandra UI acceptance surface.
- `package-lock.json` is committed and validated on the approved Node 24/npm 11 surface; use `npm ci` so local and CI dependency resolution follows that lockfile.

## Governing Product design and specifications

The highest Product philosophy authority and first Product-design filter is `docs/design/The-Core-Lattice-Philosophy.md`. Every subordinate Product design, architecture, specification, implementation convention, workflow, UI structure, validation model, roadmap artifact, and retained mechanism must conform to it. If any subordinate source or software behavior conflicts with the Core philosophy, **the Core philosophy governs and the conflicting element must be changed, removed, or explicitly reconciled by the Owner**.

Future AI-assisted design and code work must read and apply the Core philosophy before treating existing architecture, specifications, tests, implementation, or UI structure as a reason to preserve a Product direction.

Only after a Product direction passes the Core check should the subordinate design sources be used for additional precision and implementation guidance. `docs/design/Lattice-Foundational-Design-Principle.md` elaborates the Core philosophy and is subordinate to it. The canonical living Product design and forward 1.0 roadmap is `docs/design/Lattice-Living-Software-Design-to-1.0.md`; its item-level status vocabulary controls subordinate Product direction and sequencing except where a later explicit Owner decision supersedes an older item for the same bounded scope, and always subject to the Core philosophy.

For the **current structural implementation map**, including subsystem ownership, conditional decision machinery, authoritative/durable/derived state, and trust boundaries, read `docs/design/Lattice-System-Architecture.md`.

Canonical system vocabulary is defined by `docs/design/Lattice-System-Registry-and-Naming.md`; cross-cutting semantic ownership constraints are protected by `docs/design/Lattice-Architecture-Integrity.md`; and the Owner-approved offline-prototype Solandra UI design/approval is installed under `docs/design/solandra/`. All remain subordinate to `The-Core-Lattice-Philosophy.md`.

`docs/specifications/SPEC-1-Lattice-Rebuilt/` remains the detailed qualified implementation specification for confirmed contracts that the living design has not explicitly superseded. The protected V36 truth-core revision and machine-readable proof obligations remain under `docs/specifications/V36-Truth-Layer/`; `claim-proof-contracts.json` is the exact proof-obligation contract. These detailed contracts constrain implementation within their qualified boundaries but do not supersede the Core philosophy.

For the current execution view of the living roadmap, see `docs/ROADMAP.md`.
