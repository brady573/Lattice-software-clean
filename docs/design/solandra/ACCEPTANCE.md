# Solandra Acceptance Contract — Cognition / Trust Reconciled

Status: **OWNER-DIRECTED ACCEPTANCE INTENT — EXECUTION EVIDENCE REQUIRED**

Reconciled: **2026-09-08**

`../The-Core-Lattice-Philosophy.md` remains unchanged and highest Product authority. This acceptance contract is subordinate to the Core and current Owner decision OD-011.

These are black-box Product acceptance requirements for future implementation. Documentation changes do not satisfy them.

## A01 — natural ordinary-language cognition

Given an ordinary request stated in lay language, Solandra should form a materially useful interpretation and continue naturally without requiring ritual confirmation when no material ambiguity exists.

Forbidden:

- presentation-only response that cannot reason about the request;
- deterministic keyword ceremony that asks the USER to restate clearly inferable meaning;
- treating model confidence itself as USER authority.

## A02 — material ambiguity routes to Intent Integrity

When two plausible interpretations would materially change Knowledge, Recommendation/formal result, or consequential action, Solandra asks a precise natural clarification and does not silently commit the risky interpretation.

Historical USER provenance/correction remains intact.

## A03 — Knowledge acquisition beyond USER awareness

When a material external fact the USER did not know to ask about could change the outcome, Solandra may identify and acquire that information through a qualified capability.

Required:

- raw acquisition remains information;
- material factual claims cross Knowledge Trust/V36;
- unresolved/conflicting evidence remains explicit.

Forbidden: provider/model success becomes fact automatically.

## A04 — durable Knowledge provenance

A governed Knowledge result preserves traceable Source -> Evidence -> Claim support/conflict/uncertainty sufficient for later inspection.

## A05 — historical source continuity

After Solandra answers from Knowledge K and later the USER asks “What were your sources?”, the response traverses the exact provenance used by K (or its referenced Recommendation).

Forbidden:

- silently re-searching and attributing newly found sources to the old answer;
- source-count or provider reputation substituting for actual provenance.

## A06 — ordinary Recommendation without mandatory formal engine

For an ordinary advisory problem that does not require formal typed decision guarantees, Solandra can produce a materially useful Recommendation over governed Intent + Knowledge without creating/using a DecisionPlan or formal Decision Engine solely because the USER asked for advice.

Recommendation remains advisory and basis-attributable.

## A07 — optional formal capability fidelity

For a problem deliberately qualified for the formal Decision Engine, its hard-requirement/tri-state/frontier/tie semantics remain intact and Solandra explains them faithfully.

Forbidden: visual or narrative collapse of a formal multi-option frontier into a fabricated winner.

## A08 — Recommendation basis and uncertainty

A Recommendation identifies enough basis/assumptions/material uncertainty to explain why it follows and when it should change.

New material Intent/Knowledge produces successor advice rather than rewriting the old Recommendation's historical basis.

## A09 — “Explain that” reference continuity

After a Recommendation/finding, “Explain that” resolves the intended referenced governed object and explains from its exact basis without asking the USER to restate the topic unnecessarily.

## A10 — “second option” reference continuity

After alternatives are discussed, “What about the second option?” resolves the correct alternative/reference and preserves historical basis unless new analysis is explicitly performed.

## A11 — “Do it” action continuity

After a Recommendation/Resource, “Do it” resolves or creates the exact current ActionProposal.

Required:

- exact target/arguments/proposal version;
- applicable Authorization check;
- natural request for missing narrow Authorization;
- Runtime final binding/policy check.

Forbidden: pronoun resolution or prior Recommendation treated as blanket execution authority.

## A12 — authorization exactness

Authorization of ActionProposal version N cannot authorize materially changed version N+1.

Generic approval of the whole Composer must not silently authorize several independent consequential actions.

## A13 — execution receipt is not verification

After execution reports success, Solandra distinguishes that report from verified resulting state.

If an independent verification capability is available, use it before claiming verified completion. If verification is unavailable, state the limitation.

## A14 — ambiguous consequential completion

When a non-idempotent/consequential action may have executed but outcome is unknown:

- no blind retry;
- no inference from timeout/model/telemetry alone;
- reconcile with authoritative external status/idempotency evidence when available;
- otherwise preserve explicit ambiguity/action-required state.

## A15 — restart/reconnect continuity

After process/client restart, the conversation can continue from durable Intent, Knowledge, Recommendation, ConversationReference, action, receipt, and verification state without reconstructing authority from prose.

## A16 — correction lineage

A material USER correction creates successor Intent and invalidates only dependent state. Historical Intent/Knowledge/Recommendation/action records remain inspectable and are not rewritten.

## A17 — subject/privacy isolation

Another authenticated subject cannot enumerate or dereference ConversationReference, Knowledge, Resource, ActionProposal, receipt, or Verification objects from a Conversation they do not own.

Deletion blocks normal access to the owned graph and rejects late result release.

## A18 — capability-first behavior

Solandra can request a useful capability by Product purpose without provider-specific user workflow.

Provider/worker/Run/queue mechanics remain hidden in ordinary UX unless a material trust/recovery consequence makes them useful.

## A19 — user-authorized model boundary

When a USER-authorized model capability is used, its context/permissions/provenance remain bounded and logically distinct from Solandra's own cognitive role.

Its output cannot bypass Intent Integrity, Knowledge Trust, Authorization, or Verification.

## A20 — no-riddle interaction

The USER need not discover `compare`, `research`, `recommend`, `continue`, `sources`, or `what next` as hidden commands to unlock useful Product behavior.

## A21 — primary interaction frame

Ordinary primary UI remains:

- Conversation;
- free-form ConversationInput;
- adaptive Composer.

Forbidden: dashboard/orbit/workflow stepper/provider console as primary interaction.

## A22 — adaptive Composer

Composer may surface whatever currently useful trustworthy content fits the conversation: Intent, Knowledge, Recommendation, formal result when present, Resource, sources, ActionProposal, execution/verification/recovery.

No fixed user-facing presentation-stage taxonomy or global readiness gate.

## A23 — presentation fidelity

Presentation cannot strengthen:

- Solandra interpretation -> canonical Intent;
- information -> Knowledge;
- Recommendation -> Authorization;
- ActionProposal -> Authorization;
- ExecutionReceipt -> Verification;
- formal frontier -> selected winner.

## A24 — Resource behavior

A substantial Resource may take over Composer while Conversation/Input remain available. Back restores prior composition. Resource display/selection does not itself change Intent, Recommendation, Authorization, or Verification.

## A25 — source and verification inspection

When requested, Composer can present actual evidence/source/verification detail from governed objects without requiring permanent technical chrome.

## A26 — failure/recovery

Useful context remains available during recoverable failure. Product-visible copy describes the real consequence/safe next action, not raw provider/worker/database errors.

Healthy bounded recovery need not be exposed as failure.

## A27 — accessibility and responsive behavior

Keyboard reachability, visible focus, non-color material-state cues, reduced motion, IME-safe input, 200% zoom/reflow, and mobile layout preserve Conversation/Input/Composer and active Resource/action/verification content without clipping or two-dimensional page scrolling.

## A28 — design/runtime evidence boundary

Repository design checks may establish document consistency only.

Runtime acceptance requires executed evidence on an exact implementation revision, including representative real cognition, persistence/restart, Knowledge provenance, reference resolution, capability, action/authorization, ambiguity, verification, privacy, and browser usability behavior.

## Human usability questions

A representative person should be able to answer:

1. What is Solandra helping me accomplish?
2. Does Solandra appear to understand the conversation naturally?
3. Can I correct her naturally when she is wrong?
4. What does Lattice actually know versus what is tentative?
5. Why is this Recommendation being made?
6. What sources supported it?
7. Can I refer naturally to something Solandra said earlier?
8. If I say “Do it,” is the exact action clear before consequential execution?
9. Can I tell whether an action was merely reported successful or actually verified?
10. Can I use the Product without learning workflow/provider/internal-system terminology?
