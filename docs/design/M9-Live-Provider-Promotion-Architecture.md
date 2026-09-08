# M9 — Live-Provider Promotion Architecture

Status: **RECONCILED PROVIDER/CAPABILITY QUALIFICATION DESIGN — OD-005 STILL GOVERNS ROUTING PROMOTION**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This provider design is subordinate to the Core, current Owner decision OD-011, and unresolved OD-005 for routing promotion.

Scope: provider/model qualification and live-capability promotion only. This document does not authorize paid infrastructure, production deployment, production data use, secrets changes, or provider-routing policy beyond Owner-approved bounds.

## 1. Current role under OD-011

M9 qualifies model/provider capabilities used by Solandra. It does not define the Product's cognitive architecture.

Current composition:

```text
Solandra cognitive need
 -> Product capability request
 -> Lattice capability/execution policy
 -> Model Gateway / live provider route
 -> operational result + route provenance
 -> applicable consumer
      +--> Solandra cognition for proposed reasoning/drafting
      +--> Knowledge Trust/V36 for factual material
      +--> another bounded capability workflow as qualified
```

Provider/model success is not USER authority, Knowledge/truth, Recommendation authority, action Authorization, or Verification.

## 2. Solandra model role versus user-authorized model role

Keep two logical roles distinct even if one foundation model initially serves both:

- **Solandra cognition model** — implements Solandra's own semantic/reasoning runtime under Product-owned context and trust boundaries.
- **user-authorized model capability** — a model the USER has chosen/allowed Solandra to invoke for bounded work.

Qualification evidence for one role does not automatically qualify the other. Context projection, permissions, privacy, provenance, and output contracts may differ.

## 3. Reuse existing seams

Preserve and extend existing mechanisms:

- provider-neutral `ModelProvider` / Model Gateway;
- canonical request/response normalization;
- bounded timeout/input/output/tool definitions;
- durable Execution Runtime for idempotency/retry/cancellation/stale binding;
- V36 continuation/admission for factual material;
- M8 subject isolation/privacy/deletion controls;
- provider-independent qualification harnesses.

Do not create a parallel inference/research/retry/orchestration authority.

## 4. Execution classes

Retain the existing Product classifications:

```text
LOCAL_OFFLINE
LIVE_BROKERED
LIVE_DIRECT
```

`LOCAL_OFFLINE` requires verified no-external-provider egress for the qualified path; loopback URL alone does not prove it.

Execution class is a trust/data-boundary property, not a quality or semantic-authority grade.

## 5. Role/capability qualification

Qualify a provider/model for an exact role/capability, not as globally “approved.”

Evidence may include:

- structured output/tool-call support where needed;
- context capacity;
- semantic task quality for the exact role;
- malformed-output rate;
- latency/timeout behavior;
- cancellation;
- rate/quota behavior;
- privacy/retention/training terms;
- cost class;
- requested/actual route provenance completeness.

A model that performs one task well is not thereby qualified for every Solandra or user-model role.

## 6. Requested versus actual route

Live invocations should preserve normalized provenance equivalent to:

```text
executionClass
routeMode: PINNED | PRODUCT_ROUTED | BROKER_AUTOMATIC
requestedProvider?
requestedModel
actualProvider?
actualModel?
brokerIdentity?
brokerVersion?
upstreamRequestId?
routeProvenance: COMPLETE | PARTIAL | MISSING
```

If an acceptance claim depends on a specific provider/model, actual route identity must be established strongly enough for that claim.

Provider metadata remains operational evidence, not Product truth.

## 7. Routing and OD-005

Until OD-005 separately selects routing policy:

- pinned/explicit development routes may be qualified;
- automatic routing/failover may be simulated or observed as evidence;
- broker auto-routing does not silently become Product policy.

If Product-owned fallback is later authorized, it may use only routes qualified for the exact role and must preserve semantic input, privacy, capability contract, provenance, budgets, and action/verification requirements.

## 8. Minimum-necessary context

External model/provider calls receive only context necessary for the exact capability role.

Do not automatically export:

- full Conversation history;
- unrelated prior turns;
- account-wide preferences;
- historical external facts as current truth;
- secrets;
- internal provider/orchestration metadata.

ConversationReference may help select exact relevant governed objects; it is not a license to export the entire graph.

## 9. Model output and Knowledge

When a live model produces factual material, that material remains proposed information.

```text
model/provider output
 -> operational provenance
 -> Knowledge Trust / V36 where material
 -> governed Knowledge
```

Repeated model agreement, provider reputation, benchmark quality, or route success cannot bypass evidence admission.

## 10. Model tool/capability proposals

A model may propose a bounded capability call only when the invocation contract permits it.

Runtime/policy still enforces:

- declared capability;
- exact schema;
- subject/basis binding;
- permissions;
- egress;
- call/time/input/output budgets;
- side-effect classification;
- required action Authorization.

No model receives generalized shell, filesystem, database, repository, credential, network, production, or consequential-action authority by default.

## 11. Provider failure and ambiguity

Preserve current failure semantics:

- unavailable before dispatch -> bounded retry only if qualified;
- 429/5xx -> normalized transient failure;
- malformed response/tool proposal -> fail closed;
- missing route provenance -> provider-specific qualification claim fails closed;
- timeout after possible processing -> completion may be ambiguous;
- stale subject/Intent/Run/action basis -> late result rejected;
- fallback -> only qualified equivalent route.

For consequential external actions, provider ambiguity follows the action/reliability architecture and never blindly redispatches a non-idempotent action.

## 12. Privacy and provider retention

Lattice-side deletion/retention and provider-side retention/training are separate contracts.

Provider policy is volatile qualification evidence and must be refreshed for the exact route/date used. It cannot silently override Product privacy boundaries.

## 13. Zero-cost preference

Zero-cost/free-tier routes remain preferred for this one-owner hobby project where they satisfy the required capability and trust constraints.

Free status is time-sensitive evidence, not a permanent guarantee. Paid activation remains Owner-only.

## 14. M9 acceptance direction

M9 provider promotion for an exact role requires evidence that:

- the real route performs the bounded capability;
- requested/actual route provenance is sufficient;
- subject/privacy context projection holds;
- malformed output cannot acquire authority;
- retry/cancellation/timeout semantics are bounded;
- factual material cannot bypass Knowledge Trust;
- tool proposals cannot exceed capability grants/Authorization;
- route fallback matches current Owner policy;
- exact provider/model/date/revision evidence is recorded.

This is provider/capability qualification. It does not by itself establish Solandra cognition quality, Product Recommendation quality, production readiness, or 1.0 acceptance.

## 15. Historical M9 sequencing

Earlier M9 work-item sequences and provider candidates remain historical design provenance. Current forward implementation priority is controlled by the reconciled Living Design: cognition boundary, Intent Integrity, durable Knowledge, ConversationReference, capability interface, Recommendation, then action/verification completion. Provider promotion should support those Product slices rather than drive the architecture.
