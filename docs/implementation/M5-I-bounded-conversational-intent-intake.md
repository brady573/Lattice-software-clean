# M5-I — Bounded Conversational Intent Intake

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority basis: Owner-confirmed OD-001/OD-004 and the canonical living-design v0.6 amendment.

## Product-observable slice

M5-I connects one deliberately narrow natural-language laptop journey to the existing Lattice Intent Authority and exact IntentVersion-bound Run intake.

The bounded initial grammar is equivalent to:

`I need a laptop under $1,300. I'd like at least 12 hours of battery life, but performance matters more.`

The USER message is persisted first as append-only USER provenance owned by the Intent Authority subsystem. Only then may the bounded interpreter propose canonical semantics.

Independently unambiguous meaning is committed to the first immutable IntentVersion:

- objective: choose a laptop;
- hard price ceiling explicitly expressed by `under $...`;
- explicit performance-over-battery preference relation.

The battery threshold is intentionally not committed as a hard requirement from the initial message. It remains an exact MATERIAL pending proposal and the API asks whether it is a hard requirement. Exact USER confirmation (`Hard requirement.`) commits that proposal with USER_CONFIRMED provenance and then creates a Run through the existing exact `intentScopeId + intentVersionId` binding path.

## Authority boundaries

- Request text is not authoritative merely because it reached the API; the USER source record is persisted before any IntentVersion mutation.
- Unsupported initial or confirmation language fails closed before the bounded provenance ledger is advanced and cannot silently change canonical intent.
- Pending material meaning is not an IntentVersion and cannot reach execution before confirmation.
- The bounded planner consumes only the exact confirmed IntentVersion. It does not infer new USER meaning.
- The current `RunRequest.priorities` weight of `1` is implementation normalization for the existing bounded prototype engine, not a claimed generalized M6 priority magnitude or Criterion Catalog semantic.
- The legacy raw `/api/v1/conversations/:conversationId/messages` route remains non-authoritative and is not promoted by this slice.
- V36 Truth Core, Lattice Decision Engine authority, and Solandra presentation authority are unchanged.

## Persistence scope

`intent_user_messages` is a minimal M5 provenance ledger for USER messages that participate in bounded Intent Authority intake. It is not generalized M7 conversation persistence, assistant-message authority, reconnectable conversation state, cross-conversation memory, or production retention/privacy policy.

The ledger records exact conversation/scope/turn/message identity, server-owned message horizon, exact content, SHA-256 digest, USER origin, and append time. Message, logical-turn, and per-scope horizon identities fail closed on conflicting replay.

## Explicit non-goals

This slice does not implement:

- generalized natural-language interpretation;
- arbitrary clarification semantics;
- automatic correction materiality classification or correction-to-Run supersession;
- generalized DecisionPlan generation or M6 Decision Engine semantics;
- generalized M7 durable conversation/message UX;
- Solandra browser wiring for this new API path;
- live research/provider promotion;
- authentication/multi-user privacy completion;
- production deployment/readiness.

The next bounded M5 slice should connect a later material USER correction to existing immutable correction lineage and M5-G Run supersession, while preserving the same persisted-USER and exact-version authority boundary.
