# Solandra UX Contract — Offline Prototype

Status: **OWNER-APPROVED — OFFLINE PROTOTYPE UX CONTRACT / HISTORICAL PACKAGE BASIS**  
Approval date: 2026-08-26  
Accessibility target: WCAG 2.2 AA  
Approved package archive SHA-256: `36a343029d2f455af1767b853bbd527710b63331efc805b02a672bbb2bbbfcd8`

This repository adaptation records the approved offline-prototype UX package. V36 remains factual authority, StructuredDecision remains decision authority, and Solandra/client presentation is downstream and read-only.

## Current precedence

The approved package was subsequently refined by later Owner-approved primary-interaction work and by the Owner correction retiring the former fixed presentation-stage/global-gate model.

For the **current primary Solandra interaction**, `PRIMARY-INTERACTION-CONTRACT.md` controls and supersedes conflicting orbit-first, dashboard-first, `Next Step`, workflow-state, textarea-as-`Composer`, and staged-presentation terminology. The current companion presentation documents are:

- `CONVERSATION-FLOW.md` — continuous conversational flow, clarification, information gathering, content licensing, and correction behavior;
- `UI-DESIGN.md` — concrete current composition behavior;
- `UNIVERSAL-UI-DESIGN.md` — domain-independent primary UI rules;
- `BASELINE-LAYOUT-INVARIANTS.md` — geometry/responsive constraints;
- `DESIGN.md` — visual tokens and component vocabulary; and
- `ACCEPTANCE.md` — black-box presentation/interaction acceptance intent.

Application-level Resource identity, provenance, validity, hydration and prepared-action semantics are owned by `../Lattice-Resource-and-Action-Architecture.md`. Product-visible failure, reconnect, recovery and observability semantics are owned by `../Lattice-Reliability-and-Recovery-Architecture.md`. This UX contract may describe how those states are presented, but it does not redefine them.

The immutable approved package archive referenced above remains historical provenance. Historical interaction sequences in that package are not current Product requirements when they conflict with the later primary-interaction lock and Owner correction.

## Current experience contract

The current primary experience is:

```text
continuous Conversation
  + adaptive Composer
  + free-form ConversationInput
```

Solandra may clarify USER meaning, gather information, present supported findings, compare options, explain uncertainty, present recommendation/frontier state, provide Resources, and support action according to what is useful and what the owning Product authority licenses.

The user should not need to understand providers, workers, tasks, proof obligations, orchestration, presentation stages, or internal state machines.

Accepted USER meaning remains distinct from pending interpretation. Requirements and preferences remain categorically distinct. The browser/client does not acquire intent authority by rendering either.

Already-valid useful information does not need to be withheld while unrelated clarification, research, or decision work remains incomplete. Incomplete work likewise cannot be promoted into authoritative content merely because the UI wants a clean transition.

## Historical Knowledge Orbit interaction — superseded for primary interaction

Owner-approved package direction on **2026-08-29** used a visible `Conversation → Sun → Planets → Moons` Knowledge Orbit hierarchy.

That orbit-first primary interaction was superseded by the Owner-approved August 31 Composer contract. It is retained here only as historical package provenance and must not be used to reintroduce orbit navigation, Sun/Planet/Moon hierarchy, or abstract orbital controls into the current primary UI.

The still-valid semantic lessons from that design are narrower:

- presentation changes do not rewrite historical authoritative state;
- visual relationship, distance, size, motion or position never establish truth, confidence, eligibility, score, recommendation authority or selection;
- presentation-only expansion does not change underlying Product state;
- reduced-motion preference removes non-essential animation without removing information; and
- deeper evidence/provenance remains progressive rather than permanent primary-screen machinery.

Current visual and interaction behavior belongs to `PRIMARY-INTERACTION-CONTRACT.md`, `UI-DESIGN.md`, `UNIVERSAL-UI-DESIGN.md`, and `BASELINE-LAYOUT-INVARIANTS.md`.

## Recommendation and alternatives

The current UI must preserve the shape of authoritative Decision Engine state.

A single recommendation may receive visual prominence only when authoritative Product state supports that presentation. If the Decision Engine returns several materially distinct frontier options, a tie, unresolved outcome, limitation, or no safely recommendable option, the UI must preserve that state rather than visually manufacturing one winner.

Ineligible alternatives are explicitly distinguishable where they are materially useful to show. Raw scores must not visually rescue an ineligible option.

## Evidence

Evidence remains progressive disclosure:

1. what fact mattered;
2. what effect it had;
3. which admitted evidence supports or contradicts it;
4. whether it is current/applicable; and
5. verification/provenance detail when useful or intentionally requested.

Source presence or source count never implies truth. `UNVERIFIED` means not established, not false. `MIXED` means credible conflict remains. `OUTDATED` means the evidence is not current/applicable. Rejected evidence cannot appear as positive support.

## Progress and recovery presentation

Only public user-relevant Product state may drive progress copy. Do not expose provider names, worker/task activity, hidden reasoning, or fake percentages.

`Stop` appears only when the Product can genuinely cancel the authoritative Run. A transport abort is not sufficient.

Failures preserve useful context and provide a specific safe next action when one exists. Raw backend errors are never shown directly.

The Product meaning of failure, recovery-in-progress, ambiguous completion, cancellation, supersession and degraded operation comes from the applicable Runtime/domain state and `../Lattice-Reliability-and-Recovery-Architecture.md`. This section governs presentation only.

## Conversation input and intent revision

The **ConversationInput** text-entry control uses textarea semantics, bounded growth, IME-safe Enter handling, Shift+Enter newline, stable focus, and no silent queuing of local drafts.

`Composer` is reserved for the shared visual information surface defined by the current primary interaction contract. The textarea/send control must not be called or treated as the Composer.

The historical offline prototype could enable a **separate transient conversation-test mode** when a Product-owned `ModelRuntime` was configured against the approved loopback OpenAI-compatible simulator boundary.

That conversation-test mode obeyed these additional rules:

- the browser transcript was transient and was not durable Product conversation state;
- each simulated assistant turn was visibly identified as simulation material, not verified evidence or an authoritative decision;
- simulated text could not create or alter V36 truth, hard-requirement results, candidate eligibility, ranking, winner identity, or historical authoritative results;
- the UI did not expose provider names, model internals, worker/task state, hidden reasoning, or provider confidence;
- ConversationInput remained available while a response was pending so the user could draft, but the draft was never silently queued or auto-sent;
- an unanswered failed simulated turn had to be retried before another message could be sent; any local draft remained intact and the retry reused the same logical turn identity;
- each message was bounded to 4,000 characters and the transient transcript to 24 messages; reaching the bound disabled further sends with an explanation for starting a fresh transient conversation;
- when the simulator was not configured, that prototype path failed closed; and
- simulator failure preserved the transcript and offered explicit retry for the unanswered turn.

These bullets document the approved prototype surface at its historical scope. Current durable Conversation/Intent behavior must be read from fresh source and the applicable Product architectures rather than inferred from the old transient simulator constraints.

After a completed authoritative decision, changed material criteria/intent create a new/versioned decision context under current Intent Authority semantics. Historical authoritative results are not visually rewritten.

## Scroll and overlays

The consultation has one primary scroll owner. Sticky UI must not create a nested conversation scroller.

When asynchronous updates exist, respect manual scroll-up and use a `New update` affordance instead of forced scrolling when that behavior is implemented. A simulation-only prototype may use wording specific to simulated responses only within that explicit surface.

Modal/non-modal layers must preserve focus ownership/restoration, and Escape closes only the topmost dismissible layer. Current geometry must also satisfy the later `BASELINE-LAYOUT-INVARIANTS.md` and `ACCEPTANCE.md` contracts.

## Accessibility

Required:

- native semantics where practical;
- explicit text for every material state;
- no color-only status;
- visible focus;
- keyboard access for available controls/disclosures;
- polite live regions for routine progress/completion;
- reduced-motion support;
- 200% zoom/reflow without two-dimensional page scrolling;
- important touch controls approximately 44×44 CSS px where practical; and
- routine updates never steal focus.

## Acceptance boundary

Repository tests are necessary but do not establish full UI acceptance. Browser-observable acceptance must cover the applicable current scenarios in `ACCEPTANCE.md`, including visible semantics, authoritative server state, keyboard/focus/live-region behavior, narrow viewport/reflow, slow/failure/retry states, reduced motion, IME-safe composition, primary Composer hierarchy, continuous adaptive composition, and authority separation.

A screenshot alone is not Product acceptance evidence.

This file remains an approval/provenance-bearing UX record for the offline prototype. It must not be used to revive superseded orbit-first interaction, textarea-as-Composer terminology, fixed staged-presentation assumptions, single-winner assumptions, transient-simulator limits, or other historical package details that conflict with later qualified Product design.
