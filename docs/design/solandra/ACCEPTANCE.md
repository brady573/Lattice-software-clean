# Solandra Offline Prototype Acceptance Contract

Status: **OWNER-APPROVED ACCEPTANCE INTENT — EXECUTION EVIDENCE REQUIRED**

The approved package defines the following black-box scenarios. Each executed probe records user input, authoritative expectation, presentation expectation, forbidden presentation, observed result, and exact revision/state.

`PRIMARY-INTERACTION-CONTRACT.md` is the controlling primary-interaction acceptance basis for Solandra. `../Lattice-Intent-and-Decision-Architecture.md` supplies the semantic fidelity constraints for USER meaning, evidence, recommendation, selection, confirmation, and uncertainty.

## Core acceptance slice

### A01 — authoritative decision fidelity
Input: a decision with at least one exact USER hard requirement and at least one material preference or priority, plus the qualified evidence required to evaluate viable options.

Required: Decision Engine / StructuredDecision determines eligibility and recommendation/frontier state; an option that fails an applicable hard requirement remains ineligible regardless of lower-priority appeal; presentation leads with the authoritative result and does not present ineligible alternatives as ordinary runners-up.

Forbidden: score visually rescues an ineligible option.

### A05 — evidence inspection
Decision effect must lead to the material fact, then licensed evidence and verification/provenance detail. Rejected/non-qualifying evidence cannot appear as positive support.

### A07 — presentation tampering
Changing browser-side winner/eligibility cannot change backend authority; authoritative re-fetch must restore licensed state.

### A08 — active progress
Only truthful public Product progress. No fake percentage and no provider/worker/task exposure.

### A10 — failure recovery
Useful context remains, recovery is specific, and the Product does not collapse to a generic dead-end error page.

### A12 — accessibility
Available controls and evidence disclosure are keyboard reachable; focus is visible; material states have text/non-color cues; routine live updates do not steal focus.

### A13 — mobile / 200% zoom
Conversation, conversation input, Composer content, material uncertainty, useful information, and any active resource remain reachable and legible without two-dimensional page scrolling, clipping, or overlapping primary content.

### A21 — core primary interaction
The ordinary primary UI consists of Conversation, conversation input, and Composer.

Required:
- Conversation carries the interpersonal exchange with Solandra.
- Conversation input remains free-form and is not treated as a workflow controller.
- Composer is the dominant visual information surface.
- Composer content changes according to what is most useful at the current point in the conversation.

Forbidden:
- calling or treating the textarea/send control as the Composer;
- a permanent dashboard, orbit, workflow stepper, card grid, or resource tray competing with the core interaction;
- duplicate panels without distinct user purpose.

### A22 — continuous adaptive Composer behavior
Ordinary interaction is one continuous conversation rather than a fixed user-facing presentation sequence.

Required:
- Composer may show accepted USER meaning whenever seeing that meaning is useful;
- material pending interpretation remains distinguishable from accepted meaning whenever both are shown;
- already-supported useful information may appear while unrelated clarification, research, or decision work remains unresolved;
- findings, comparisons, recommendation/frontier state, warnings, plans, Resources, and inspection detail may become visually primary whenever useful and licensed by their owning Product authority;
- Conversation can clarify, explain, correct, compare, recommend, or prepare action without requiring dedicated workflow navigation.

Forbidden:
- a fixed user-facing presentation-phase taxonomy;
- presentation-stage controls the user must operate to make Solandra advance;
- a global gate that withholds already-valid useful information solely because another category of work is unfinished;
- presenting pending interpretation as though it were already canonical USER meaning;
- permanent `Next Step`, `Compare`, `Details`, or similar workflow chrome.

### A23 — content licensing and no-riddle behavior
Every material piece of Composer content must be faithful to the Product authority that licenses its meaning.

Required:
- accepted USER meaning comes from Intent Authority;
- external factual claims presented as established come from V36-admitted evidence;
- comparison/recommendation/frontier/selected-outcome presentation comes from Decision Engine / StructuredDecision state;
- consequential action remains separately authorized and executed;
- data gathering may include information the person did not know to ask for when it materially improves usefulness, accuracy, or actionability;
- useful licensed information is surfaced naturally without requiring a trigger phrase;
- a supported limitation may itself be presented when materially useful;
- a material correction retires or recomputes stale dependent Composer content without forcing unaffected valid content to disappear.

Forbidden:
- requiring trigger phrases such as `compare`, `research`, `recommend`, `continue`, or `what next` merely to make Solandra useful;
- treating model confidence or model prose as Product authority;
- treating accepted USER meaning as proof that external facts, recommendation state, a selected outcome, or action authorization already exists;
- withholding a supported Resource, finding, or explanation merely because some unrelated Product work remains incomplete;
- strengthening incomplete research or decision work into established content because the UI wants a cleaner state.

### A24 — useful information, recommendation shape, and resources
Composer may include explanations, findings, comparisons, recommendations, warnings, uncertainty, plans, maps, links, contacts, documents, media, checklists, generated artifacts, or actionable guidance.

Required:
- Composer prioritizes the most useful information currently licensed for the person's need;
- external factual claims presented as established remain faithful to V36-admitted evidence;
- comparison/recommendation/frontier/selected-outcome presentation remains faithful to Decision Engine / StructuredDecision state;
- a multi-option material-dominance frontier remains multi-option unless valid authoritative selection exists;
- a materially useful supported limitation may itself be presented;
- a substantial resource may take over Composer while Conversation and conversation input remain available;
- one quiet Back action restores the prior Composer composition;
- criteria/evidence/provenance may be presented through Composer when intentionally requested.

Forbidden:
- fabricating a single winner because one dominant visual answer is easier to present;
- visual emphasis that implies selected-outcome authority not present in StructuredDecision;
- using provider status, worker progress, or similar internal activity as a substitute for useful information;
- a permanent resource taxonomy or technical inspector occupying the ordinary primary screen;
- showing resources merely because they exist.

### A25 — Composer discard rule
Every permanent primary UI element must materially support at least one of:

1. Conversation; or
2. making the Composer more useful for understanding, deciding, or acting.

It must also preserve the semantic authority of the state it presents.

Forbidden:
- empty structural placeholders for content that is not currently useful;
- permanent `Why this matters` chrome when there is nothing useful to explain;
- raw criterion keys, intent/decision-plan IDs, provenance handles, provider status, source-count badges, or implementation classifications competing with useful information;
- retaining an understanding-first layout after other information has become more useful;
- fixed presentation-stage or workflow chrome.

When consequential explanation is useful, it may appear as direct Composer content rather than as abstract navigation.

### A26 — semantic presentation fidelity
The UI may simplify internal machinery but must preserve the semantic distinctions that affect USER meaning or decision trustworthiness.

Required:
- accepted USER meaning remains distinguishable from pending interpretation;
- a material confirmation interaction binds an exact, current pending USER-meaning proposition under Intent Authority semantics;
- intent uncertainty, evidence uncertainty, and decision uncertainty remain distinguishable in the semantic presentation/read model even when visible copy is plain-language;
- USER intent confirmation does not visually imply confirmation of external facts, recommendation correctness, delegation, selected outcome, or external action authorization;
- presentation-only changes cannot mutate or strengthen canonical intent, V36 evidence, eligibility, recommendation/frontier membership, or selected-outcome state.

Forbidden:
- using one generic confidence value to stand in for intent, evidence, and decision uncertainty;
- treating a generic `yes` to a broad understanding screen as bulk confirmation of materially independent pending interpretations unless the exact combined proposition is unambiguous and valid under Intent Authority semantics;
- reconstructing semantic authority from presentation text;
- converting a recommendation frontier into a winner through visual ordering, size, color, or copy.

## Conversation-test prototype

These scenarios apply when the offline model simulator is configured for the prototype.

### S01 — simulated conversation round-trip
A user can enter arbitrary text through the conversation input and receive a simulated assistant reply in the same consultation thread. The reply is labeled as conversation-test material.

### S02 — simulation cannot strengthen Product authority
The simulated response must not expose or create `verified`, confidence, truth-verdict, evidence-admission, ranking, winner, or decision authority. Authoritative decision state remains produced only through the existing V36 → StructuredDecision path.

### S03 — explicit configuration boundary
When no Product-owned model runtime is configured, the existing canonical disabled-input state remains and the prototype conversation endpoint fails closed. No remote provider fallback is permitted.

### S04 — simulator failure and retry
A simulator transport/provider failure preserves the visible transcript, reports a plain-language failure without raw backend detail, and offers retry for the unanswered turn. Draft text entered while a response is pending is not auto-sent. A failed unanswered turn blocks a later send until that same logical turn is retried.

### S05 — conversation input, context, and update behavior
Enter sends only when IME composition is inactive; Shift+Enter creates a newline. Each message is limited to 4,000 characters and the transient transcript is limited to 24 messages with an explicit boundary message when reached. A simulated response does not force-scroll a user who deliberately moved away from the newest content; a `New response` affordance is provided instead.

## Future-capability scenarios retained by the approved package

These become applicable only when the corresponding Product capability exists:
- A02 missing requirement evidence → unknown/insufficient, not automatic pass/fail;
- A03 contradictory evidence → conflict remains explicit, no source-majority shortcut;
- A04 outdated evidence → temporal problem explicit;
- A09 cancellation → Stop only when supported; cancelling/cancelled distinct;
- A11 post-decision requirement change → historical result preserved, new evaluation separate;
- A14 clarification necessity → ask only outcome-changing questions;
- A15 uncertainty blocks decision → no cosmetic winner;
- A16 active Run local draft → no silent queueing;
- A17 scroll ownership/new update → manual reading position respected;
- A18 overlay/focus behavior → modal/non-modal contracts preserved;
- A19 IME-safe input → composition Enter does not send; Shift+Enter newline;
- A20 degraded transport/uncertain completion → authoritative re-fetch before duplicate retry when outcome is uncertain.

## Current acceptance boundary

The core decision acceptance boundary includes A01, A05, A07 authority separation, A08 truthful indeterminate progress, A10 failure recovery, A12 available-control accessibility, A13 responsive/reflow requirements, and A21-A26 primary-interaction/semantic-presentation requirements.

When model simulation is configured, S01-S05 additionally apply to the transient conversation-test surface. S01-S05 do **not** establish natural-language intent interpretation, durable conversation semantics, V36 acceptance of model output, or authoritative model-assisted decision making.

Repository tests can establish server projection, model-boundary isolation, static markup properties, and deterministic presentation contracts. Full acceptance still requires an actual browser/usability pass on the exact candidate revision for keyboard, focus, zoom/reflow, reduced motion, IME composition, manual-scroll preservation, slow/failure/retry behavior, presentation comprehension, Composer hierarchy, pending-versus-accepted understanding, recommendation shape, uncertainty routing, confirmation semantics, resource behavior, and the absence of a fixed presentation-phase/global-gate interaction.

The Android real-device screenshots from 2026-08-31 are Product-observable evidence that the pre-lock implementation did not satisfy the later primary-interaction direction. Those observations do not transfer to future revisions.

## Interaction design fixtures

UI inspection examples may use any number or order of representative turns. Fixtures should exercise semantic consequences without defining domain schema or a canonical presentation sequence.

At minimum, useful fixture coverage includes:

- clarification while already-valid useful content remains visible;
- newly admitted evidence becoming useful during an ongoing conversation;
- a multi-option decision frontier without a fabricated winner;
- a material correction invalidating only dependent presentation;
- Resource takeover and return;
- recovery while preserving the last trustworthy Composer state.

A fixture's order, turn count, topic, or nouns are not authoritative Product behavior.

If a fixture displays external facts, a comparison, recommendation/frontier, or selected outcome, its exact fixture basis must license those claims. Persuasive copy alone is not fixture authority.

## Human usability gate

A representative user should be able to answer:
1. What is Solandra helping me with right now?
2. What information on the Composer is most useful now?
3. If Solandra is proposing an interpretation, can I tell that it is tentative rather than already accepted?
4. Can I correct or clarify naturally without operating a workflow?
5. Can useful supported information appear even if another question or research task is still unresolved?
6. Can I tell whether a material statement is a fact, recommendation, option set, limitation, or prepared resource when that distinction matters?
7. If there are several credible options, can I see the meaningful trade-off without a fabricated winner?
8. Why is the information consequential to my decision or next step?
9. What can I do with the Composer content right now?
10. Can I change the basis and have stale dependent content reconsidered?
11. Can I inspect deeper evidence/provenance if I intentionally ask?
12. Can I use the experience without learning hidden commands, stage names, or UI machinery?

Functional correctness, semantic fidelity, and human comprehension are separate gates.
