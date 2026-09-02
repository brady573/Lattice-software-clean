# Solandra Primary Interaction Contract

Status: **OWNER-APPROVED PRODUCT INTERACTION LOCK**  
Approval date: 2026-08-31  
Authority basis: explicit Owner direction from the 2026-08-31 Android review and subsequent UI-concept reconciliation, including the later Owner correction retiring the fixed presentation-phase model.

This contract is the controlling Solandra presentation rule for the primary user experience. It supersedes conflicting orbit-first, dashboard-first, `Next Step`, workflow-state, fixed presentation-phase, global presentation-gate, and prior lower-field/composer terminology. It does not change Lattice truth authority, Intent Authority, DecisionPlan, Run, V36, StructuredDecision, security, production, cost, or validation boundaries.

`../Lattice-Intent-and-Decision-Architecture.md` supplies the cross-system semantic constraints for USER meaning, evidence, recommendation, selection, confirmation, and uncertainty. This interaction contract controls presentation behavior only and must remain faithful to those semantic boundaries.

## 1. Core concept

Imagine Solandra standing with the person and having a conversation while using a shared screen beside her.

Solandra's job is to provide accurate, actionable information that helps the person understand, decide, or take the right next step. She may clarify meaning, gather information, research, compare, explain, recommend, challenge, prepare resources, or help the person act as the situation requires.

The shared screen is the **Composer**.

The Composer is not the text-entry box. It is the primary visual information surface Solandra uses throughout the conversation.

The primary experience is therefore:

1. **Conversation** — the person and Solandra communicate.
2. **Composer** — Solandra visually presents the most useful information for the current point in that conversation.
3. **Conversation input** — the text-entry/send control through which the person can speak to Solandra when using text.

Any permanent UI element that cannot justify itself inside this model should not exist in the primary experience.

## 2. Continuous interaction model

Ordinary Solandra interaction is one continuous conversation, not a user-facing sequence of fixed stages.

Solandra may move naturally among clarification, investigation, explanation, comparison, recommendation, correction, evidence review, resource use, and action preparation according to what is useful now. Those activities do not require the person to understand or operate a workflow model.

The Composer changes because the useful information changes, not because the UI advances through a fixed presentation taxonomy.

Examples of useful Composer content include:

- a concise representation of accepted USER meaning;
- a tentative interpretation that is clearly still pending when seeing it helps the person respond;
- a supported fact or finding;
- material uncertainty or limitation;
- a comparison;
- authoritative recommendation/frontier state;
- a warning;
- a plan or sequence;
- a map, contact, document, image, video, checklist, prepared message, generated artifact, or other contextual resource;
- evidence, provenance, verification, or audit detail when intentionally requested.

These are **content patterns**, not phases, permanent regions, or hidden unlock states.

The person should not need to discover a special command such as `compare`, `research`, `recommend`, or `next step` to make Solandra useful. When useful content is available and licensed by the Product authority that owns its meaning, Solandra should surface it naturally.

## 3. Content licensing and semantic fidelity

There is no global presentation-state gate that independently decides when Solandra may become useful.

Instead, each material piece of content must be faithful to the Product authority that licenses the meaning it presents:

- accepted USER meaning comes from Intent Authority;
- pending interpretation remains proposal material until resolved under Intent Authority semantics;
- external factual claims depend on V36-admitted evidence;
- eligibility, comparison, recommendation/frontier state, and any selected outcome depend on Decision Engine state;
- consequential external action remains subject to the applicable authorization and Execution Runtime boundaries;
- presentation may explain, organize, prioritize, or render those states but may not strengthen them.

Solandra may ask a clarification question whenever unresolved USER meaning materially affects what should happen next. She may also present already-supported useful information without waiting for a separate presentation milestone, provided doing so does not misrepresent unresolved intent or strengthen another Product authority.

Likewise, investigation or decision work may continue while the Composer shows whatever trustworthy information is already useful. Internal work-in-progress does not require a special user-facing phase or progress-only screen.

A supported limitation can itself be useful content when that limitation materially affects the person's understanding, decision, or action.

## 4. Composer law

At every point, ask one question:

**What is the most useful thing for this person to see on the shared screen right now?**

The answer determines Composer content, subject to the semantic fidelity rules above.

`What I understand`, consequential explanation, comparison views, recommendations, evidence, and resources are Composer content patterns, not permanent structural regions that must occupy the screen at all times.

A pattern should appear only when it makes the Composer more useful at that moment.

The Composer should prefer useful information over narration of internal Product state. It should not normally announce workflow, semantic-category, provider, worker, or execution labels simply to explain why content is present.

## 5. Conversation, input, and exact confirmation

Conversation is the interpersonal exchange. It carries Solandra's questions, explanations, corrections, knowledge, and continuity.

The conversation input is only an input mechanism. It remains free-form and does not become a wizard, workflow controller, command palette, or hidden unlock mechanism.

A submitted message does not itself create accepted intent, truth, recommendation authority, selected-outcome authority, or execution authorization.

When the person needs to act or decide, Solandra communicates naturally in Conversation while the Composer presents the information that best supports that decision or action.

When a USER reply is being used to confirm pending intent meaning, the confirmation must bind the exact fresh proposition and semantic basis required by Intent Authority. A broad `yes` or approval of a whole Composer screen must not silently confirm several materially independent pending interpretations unless that exact combined proposition is unambiguous and valid under the Intent Authority contract.

A large understanding summary may support comprehension without becoming a bulk semantic-commit control.

## 6. Change and reversibility

Useful information never freezes the person's need.

If the person materially corrects or changes the request, Intent Authority updates accepted meaning under its own contract. Solandra must retire or recompute dependent presentation that is no longer valid on the revised basis.

A question or follow-up that does not change the accepted USER meaning may simply be answered without forcing a presentation reset.

Historical intent, evidence, and StructuredDecision state are not rewritten merely because the current Composer changes.

## 7. Recommendations, alternatives, and uncertainty

The Composer must preserve the shape of authoritative decision state.

A recommendation may be:

- one clearly dominant option;
- several materially distinct frontier options;
- an explicit tie or unresolved outcome;
- a limitation that prevents a safe recommendation; or
- no safely recommendable option.

Presentation must not manufacture a single winner merely because one large visual surface is easier to design. A selected outcome may be shown only when authoritative Decision Engine state actually contains one.

Uncertainty also retains its semantic source. Intent uncertainty, V36 evidence uncertainty, and Decision Engine outcome uncertainty may be translated into plain language, but the presentation/read model must not collapse them into one generic confidence state or let one kind of certainty repair another.

## 8. Resources and deeper inspection

A resource belongs in the Composer only when it materially helps the person understand, decide, or act.

Examples include a map, prepared message, contact, checklist, document, image, video, source material, or downloadable artifact.

A substantial resource may temporarily take over the Composer. Conversation and the conversation input remain available, and one quiet return action restores the prior Composer content.

Criteria, evidence, provenance, verification, and audit detail remain available when intentionally requested, but they are not permanent primary-screen chrome. If the person asks to look behind the curtain, the Composer can present that information directly without converting presentation detail into semantic authority.

## 9. Authority law

The model may propose an interpretation or useful content. It does not own accepted intent, Product truth, recommendation authority, selected-outcome authority, or execution authority.

```text
message submitted != accepted USER intent
pending interpretation != accepted USER intent
content visible != factual truth established
supported USER meaning != external facts automatically established
supported USER meaning != recommendation automatically licensed
model says "X is best" != recommendation licensed
frontier contains options != selected winner exists
recommendation presented != user decision
user decision != execution authorized
resource exists != resource should be shown
```

## 10. Primary anti-drift invariants

A Solandra UI change is non-conforming if any of these is true:

1. It cannot be explained as supporting Conversation or making the Composer more useful.
2. It treats the text-entry box as the Composer.
3. It turns an understanding summary into permanent primary-screen chrome when other information is more useful.
4. It introduces a fixed user-facing presentation-phase taxonomy or requires phase navigation for ordinary use.
5. It presents pending interpretation as accepted USER meaning.
6. It presents external claims, recommendations, selected outcomes, or action authority more strongly than the owning Product state licenses.
7. It requires the person to guess a command or solve a UI puzzle to make Solandra useful.
8. It adds permanent `Compare`, `Details`, `Next`, orbit, dashboard, workflow, or similar chrome for operations Conversation can handle naturally.
9. It repeats the same information across Conversation and Composer without a distinct user benefit.
10. It surfaces technical machinery instead of information useful to the person.
11. It retains stale dependent knowledge after the accepted USER basis materially changes.
12. It collapses intent, evidence, and decision uncertainty into a generic confidence authority.
13. It turns a recommendation frontier into a fabricated single winner or selected outcome.
14. It lets presentation or model output strengthen Product truth or authority.
15. Mobile clipping, overlap, or navigation friction makes the Composer materially less useful.

Any future UI element must pass this test before it is added:

**Does this help the person converse with Solandra or make the Composer more useful without changing who owns the underlying meaning?**

If not, discard it from the primary UI.
