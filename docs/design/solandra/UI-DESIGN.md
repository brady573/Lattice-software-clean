# Solandra Primary UI Design

Status: **OWNER-APPROVED PRODUCT UI DESIGN — PRIMARY INTERACTION**  
Approval basis: Owner direction from the 2026-08-31 Android review, subsequent Composer-concept reconciliation, the execution refinement that the Composer is a visual aid for Conversation rather than a labeled semantic surface, and the later Owner correction retiring the fixed presentation-phase/global-gate model.  
Scope: concrete screen composition and rendering behavior for the primary Solandra experience.

## 1. Role of this document

This document is the **composition specification** for the primary UI. It translates the approved Solandra interaction model into concrete rendering behavior without redefining the contracts owned elsewhere.

Companion responsibilities:

- `PRIMARY-INTERACTION-CONTRACT.md` — controlling continuous interaction concept, Conversation + ConversationInput + Composer, content licensing, and primary anti-drift rules;
- `CONVERSATION-FLOW.md` — clarification, information gathering, content licensing, correction/reversal, uncertainty routing, and conversation-input behavior;
- `BASELINE-LAYOUT-INVARIANTS.md` — stable frame and responsive geometry;
- `UNIVERSAL-UI-DESIGN.md` — domain-independent Composer rules;
- `DESIGN.md` — visual tokens and semantic component vocabulary;
- `ACCEPTANCE.md` — black-box acceptance requirements;
- `../Lattice-Intent-and-Decision-Architecture.md` — USER-meaning, evidence, decision, recommendation, confirmation, and uncertainty semantics;
- `../Lattice-Resource-and-Action-Architecture.md` — application-level Resource identity, provenance, validity, hydration, prepared-action, and execution-separation semantics;
- `../Lattice-Reliability-and-Recovery-Architecture.md` — Product-visible failure, recovery, reconnect, ambiguity, degradation, and observability semantics;
- `../Lattice-Foundational-Design-Principle.md` — Product-wide design filter; and
- `../Lattice-Architecture-Integrity.md` and `../Lattice-System-Architecture.md` — semantic ownership and Product authority boundaries.

If this document conflicts with `PRIMARY-INTERACTION-CONTRACT.md`, that contract controls presentation interaction. If presentation wording would contradict an underlying qualified semantic/application authority, that authority controls its meaning.

## 2. Screen anatomy

The primary screen contains three persistent regions:

```text
┌─────────────────────────────────────────────┐
│ Solandra                                    │
├─────────────────────────────────────────────┤
│ Conversation                                │
│                                             │
│ [ free-form conversation input          ↑ ] │
├─────────────────────────────────────────────┤
│                                             │
│                  COMPOSER                   │
│                                             │
│       useful visual information now         │
│                                             │
└─────────────────────────────────────────────┘
```

- **Conversation** is the interpersonal exchange.
- **Conversation input** is the text-entry/send control.
- **Composer** is the shared visual information surface.

The frame remains stable while Composer content changes. Geometry is defined by `BASELINE-LAYOUT-INVARIANTS.md`.

## 3. Authority-safe presentation

The human-facing experience may feel as if Solandra is listening, checking facts, gathering what she needs, comparing options, and deciding what to show next. The UI must still preserve the underlying Product authorities.

Presentation must only strengthen when licensed by authoritative Product state:

- canonical accepted USER meaning comes from **Lattice Intent Authority**;
- pending interpretation remains proposal material until accepted under Intent Authority semantics;
- operational investigation/research lifecycle comes from **Lattice Execution Runtime**;
- admitted external facts come from **V36 Truth Core**;
- eligibility, comparison, recommendation/frontier state, and `StructuredDecision` come from **Lattice Decision Engine**;
- Solandra Experience composes faithful presentation over those states.

Consequences for the UI:

- transcript text is not rendered as accepted intent merely because the person said it;
- pending interpretation is not styled or phrased as canonical accepted meaning;
- provider/model/research output is not rendered as established fact merely because it arrived;
- model prose does not visually manufacture an authoritative recommendation;
- a frontier is not rendered as a selected winner unless authoritative decision state contains a selected outcome;
- presentation changes do not create truth, decision, authorization, or execution authority.

Solandra may present the experience of gathering and understanding without becoming the semantic owner of the underlying intent, research, truth, or decision state.

## 4. Conversation and Composer coordination

Conversation and Composer have different jobs.

**Conversation** handles the human exchange: questions, clarification, acknowledgement, concise explanation, correction, and narrative framing.

**Composer** is the visual aid Solandra uses to support that exchange. It holds information that benefits from persistence, structure, comparison, spatial organization, media, or direct actionability.

The Composer is **not** a semantic-status panel and should not normally explain what category of Product state it is rendering. The Conversation already supplies interpersonal context; the Composer should let useful content itself establish the visual hierarchy.

Do not add default Composer labels such as `What I understand`, `I may be hearing`, `I'm checking`, `Useful to know`, workflow-state labels, or presentation-stage labels merely to explain why content is on the shared screen. Such labels turn the visual aid into narration of Solandra's internal process.

Labels are appropriate when intrinsic to the content itself or materially useful for comprehension—for example, an option name in a comparison, document title, map legend, warning label, or ordinary heading inside a substantial resource. They should describe information, not internal workflow.

A useful coordination pattern is:

- Conversation asks, frames, explains, or resolves the important point.
- Composer shows the visual information that best helps the person understand, decide, or act at that moment.

Pending interpretation does not require a permanent pending-interpretation region. Solandra can state the exact pending proposition naturally in Conversation while Composer continues to show other useful, valid information. If a pending interpretation itself is materially useful to see, it may appear there, but tentative status must remain clear.

Do not mirror the same paragraph, recommendation, or criteria in both places unless the second presentation adds a distinct benefit through form, persistence, structure, media, or actionability.

## 5. Adaptive Composer rendering

The Composer is continuously adaptive. It does not switch among a mandatory fixed set of presentation stages.

At any moment it may prioritize one or more content patterns that are both useful and semantically licensed:

- accepted USER meaning;
- pending interpretation where visual presentation improves response or correction;
- supported findings;
- material uncertainty or limitation;
- consequential explanation;
- comparison;
- recommendation/frontier state;
- plan or sequence;
- contextual Resource;
- intentionally requested evidence/provenance inspection;
- recovery information.

Already-supported useful information need not be withheld merely because another clarification, research task, or decision question remains unresolved. Conversely, unresolved work may not be visually upgraded into accepted intent, fact, recommendation, selected outcome, or authorization.

The visual question is always: **what is the most useful trustworthy content to place on the shared screen now?**

## 6. Understanding presentation

An understanding composition is a semantic restatement, not a transcript summary and not a mandatory UI mode.

When useful:

- accepted meaning can be presented concisely;
- materially pending interpretation can be presented separately when its tentative status remains clear;
- material intent uncertainty can be shown when seeing it helps the person respond;
- consequential explanation can show why a clarification or constraint matters.

An understanding summary may coexist with other useful content. It must not become permanent chrome or block already-licensed findings, resources, comparisons, or decision support from becoming visually primary.

## 7. Findings, comparison, and decision presentation

Supported information should be self-contextualizing through its content and composition rather than wrapped in workflow labels.

When applicable, prefer a useful hierarchy such as:

1. critical supported conclusion, finding, or decision state;
2. decisive reasons or trade-offs;
3. material uncertainty or limitation;
4. a concrete Resource that reduces friction for the next decision/action;
5. deeper support when useful or requested.

This is not a mandatory template. Omit anything that does not help the current person and problem.

If authoritative recommendation state is a multi-option frontier, the composition must preserve that frontier. First position, type size, card size, color, or narrative emphasis may clarify trade-offs but cannot fabricate a winner.

Ordinary Composer content should not lead with raw IDs, criterion keys, provider/model status, source-count badges, generic confidence meters, workflow labels, semantic-category labels, or implementation classifications.

## 8. Uncertainty presentation

The UI may translate uncertainty into ordinary language, but the semantic read model must preserve which authority owns it.

At minimum, do not collapse:

- **intent uncertainty** — unresolved USER meaning;
- **evidence uncertainty** — unresolved external-world truth under V36;
- **decision uncertainty** — what outcome is supportable from exact intent plus admitted evidence.

A single generic confidence meter must not imply that confidence in one domain repairs uncertainty in another.

The Composer need not display the names of these uncertainty domains. It needs to preserve their consequences faithfully when uncertainty is materially useful to show.

## 9. Confirmation presentation

An understanding composition can help the person inspect the request, but confirmation semantics remain proposition-bound.

UI rules:

- do not treat the whole Composer composition as one bulk semantic approval merely because the person says `yes`;
- when a material pending interpretation requires confirmation, make the exact proposition being confirmed unambiguous in Conversation or Composer;
- independent material propositions should remain independently resolvable when Intent Authority requires that distinction;
- confirmation of intent never visually implies confirmation of external facts, recommendation correctness, winner selection, delegation, or external action authorization.

The UI may keep confirmation conversational. It does not need to become a form or expose internal semantic labels to make confirmation valid.

## 10. Resource and inspection presentation

Application Resource identity, provenance, version, subject/basis binding, validity/relevance, hydration, use capabilities, prepared-action state, and `ActionProposal` semantics are defined in `../Lattice-Resource-and-Action-Architecture.md`.

When a substantial Resource becomes active:

- it becomes the Composer's active content;
- unrelated Composer content is hidden rather than stacked around it;
- Conversation and ConversationInput remain available;
- one quiet `Back` action restores the prior Composer composition; and
- technical inspection uses the same Composer surface rather than creating a permanent evidence console.

The first inspection layer should remain understandable to a normal person. More technical detail appears only as intentionally requested.

Showing, opening, copying, editing, hydrating, preparing, or visually emphasizing a Resource does not itself create factual validity, recommendation authority, consequential-action authorization, or execution authority.

## 11. Pending work and failure presentation

Product-visible reliability state, recovery ownership, retry/ambiguity semantics, reconnect, cancellation/supersession distinctions, and scoped degradation are defined by the owning Product state and `../Lattice-Reliability-and-Recovery-Architecture.md`.

The UI should:

- keep the last trustworthy Composer composition visible when useful;
- never optimistically render accepted intent, stronger evidence, a recommendation, or a selected outcome before Product state licenses it;
- expose only truthful public progress;
- avoid fabricated percentages, provider/worker activity, or internal workflow chrome;
- preserve useful context on failure and present the recovery action that actually exists; and
- not treat `CANCELLED`, `REQUEST_SUPERSEDED`, or healthy `RECOVERY_IN_PROGRESS` as generic failure merely because they are reliability-relevant.

Raw provider, worker, database, stack-trace, or diagnostic detail is not the default Product-visible failure contract.

Internal work remaining incomplete does not require an empty or progress-only Composer. Any already-valid useful content can remain or become primary while that work continues.

## 12. Responsive composition

Responsive geometry and accessibility requirements are defined in `BASELINE-LAYOUT-INVARIANTS.md` and `ACCEPTANCE.md`.

The composition-specific requirement is simple:

**the most useful Composer information must remain visually primary at every supported width.**

Desktop may increase whitespace and readable measure. Mobile may reduce type scale and spacing. Neither may turn Composer into a dashboard, hide critical information, clip the active Conversation turn, or require abstract navigation for core information.

## 13. Visual composition

Visual tokens and component styling are defined in `DESIGN.md`.

This document adds these composition rules:

- one coherent Composer composition at a time;
- treat Composer as a flexible visual canvas whose contents may range from a single statement to a comparison, map, document, plan, media object, or other useful resource;
- let information establish context and hierarchy rather than wrapping it in permanent semantic/category labels;
- hierarchy through placement, readable measure, whitespace, typography, restrained rules, and content-appropriate structure;
- avoid card proliferation or status chrome that competes with active information;
- do not use decorative orbit controls, AI glow, confidence gauges, provider/task widgets, or implementation machinery as primary interaction;
- the most useful licensed content should visually dominate Composer;
- visual emphasis must not imply stronger semantic authority than underlying state provides.

The frame is stable; the visual composition is fluid. Each state should feel like the natural visual aid for the conversation happening now rather than a required member of a UI state sequence.

## 14. Presentation naming

To prevent terminology drift:

- **Composer** is the Product concept for the shared visual information surface;
- implementation/component names should prefer `ComposerSurface` or another unambiguous equivalent;
- **ConversationInput** identifies the textarea/send control;
- do not name the text-entry component `Composer` in a way that makes Product documentation ambiguous.

These are presentation names, not new semantic authorities and not labels that must appear in the rendered UI.

## 15. UI discard and duplication test

Before adding permanent primary UI, ask:

1. Does it materially help the person converse with Solandra?
2. Does it materially make the Composer more useful for understanding, deciding, or acting?
3. Does it preserve the authority of the state it presents?

If the first two answers are no, remove it. If the third answer is no, redesign it.

Also remove or reject:

- duplicated Conversation/Composer text without a distinct benefit;
- permanent workflow or presentation-stage chrome;
- empty placeholders for future information;
- permanent evidence/resource shelves that are not currently useful;
- technical machinery presented as ordinary user information;
- understanding-first layout that remains dominant regardless of what is actually useful;
- any visual treatment that strengthens pending, factual, recommendation, selected-outcome, or action state beyond its authority.
