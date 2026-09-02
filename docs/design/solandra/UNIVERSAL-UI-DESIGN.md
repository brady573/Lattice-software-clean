# Solandra Universal Primary UI Design

Status: **OWNER-APPROVED PRODUCT UI DIRECTION — UNIVERSAL PRIMARY INTERACTION**  
Approval basis: Owner direction on 2026-08-31 that the design must be domain-independent and governed by the Composer concept, plus the later Owner correction retiring the fixed presentation-phase/global-gate model.  
Scope: primary Solandra consultation UI across desktop and mobile for any supported decision, planning, clarification, research, learning, or action-oriented conversation.

`PRIMARY-INTERACTION-CONTRACT.md` controls interaction conflicts. `../Lattice-Intent-and-Decision-Architecture.md` constrains semantic presentation of USER meaning, evidence, uncertainty, recommendation, selection, and confirmation.

## 1. Universal design law

The UI is organized around the person's evolving need, not around a domain, data model, candidate type, workflow, or backend object.

The universal primary frame has three parts:

1. **Conversation**
2. **Conversation input**
3. **Composer**

The Composer is the shared visual surface Solandra uses to present what is most useful at the current point in the conversation.

Ordinary interaction is continuous. The Product does not require a fixed user-facing presentation sequence or one global content-readiness gate before useful information may appear.

## 2. Topic-independent frame

```text
┌─────────────────────────────────────────────┐
│ Solandra                                    │
├─────────────────────────────────────────────┤
│ compact Conversation                        │
│ [ free-form conversation input          ↑ ] │
├─────────────────────────────────────────────┤
│                                             │
│                  COMPOSER                   │
│                                             │
│       useful visual information now         │
│                                             │
└─────────────────────────────────────────────┘
```

The Composer changes content; the application frame does not become a candidate dashboard, task board, resource catalog, evidence console, orbit, card grid, or workflow stepper.

## 3. Adaptive Composer behavior

Composer content adapts to what is useful and licensed now.

It may show accepted USER meaning while Solandra clarifies another point, present a supported finding while other research remains underway, show a comparison or recommendation frontier when Decision Engine state licenses it, or give a substantial Resource the entire visual surface when that most helps the person act.

No presentation category must be completed before another kind of useful content can appear. Presentation does not manufacture semantic permission; every material claim remains constrained by the Product authority that owns it.

The Composer should not narrate internal workflow merely to explain why information is present. Prefer the information itself.

## 4. Universal Composer content

The Composer must not assume every conversation has:

- candidates;
- rankings;
- numeric criteria;
- a winner;
- a purchase;
- a hard/soft requirement taxonomy;
- a document artifact;
- an external action;
- a single recommendation.

Instead, the renderer should compose by semantic meaning, authoritative basis, and current usefulness.

Useful universal content patterns include:

- accepted understanding summary;
- pending interpretation when seeing it helps the person respond;
- material uncertainty;
- consequential explanation;
- supported finding;
- comparison;
- recommendation/frontier presentation;
- warning;
- plan;
- contextual resource;
- recovery information;
- intentionally requested evidence/provenance detail.

These are content patterns, not interaction stages or permanent screen regions.

## 5. Examples are fixtures, not schema

Different supported conversations can use the same frame because the Composer changes what it presents. No topic-specific example defines Product schema, acceptance, or universal presentation structure.

A fixture may show Solandra asking one unresolved material question while Composer continues to display already-valid useful context. Another fixture may show a newly admitted fact becoming visually primary while unrelated work continues. Another may show several authoritative frontier options and their material trade-offs without implying that one has been selected.

A fixture can also demonstrate a substantial Resource taking over the Composer while Conversation and ConversationInput remain available.

The universal rule is the adaptive transformation of the Composer, not the domain nouns, ordering, or turn count used by a fixture.

## 6. Semantic authority is universal too

Domain independence must not erase semantic ownership.

Across every supported domain:

- accepted USER meaning remains distinct from pending interpretation;
- external factual claims require the applicable V36 evidence basis;
- recommendation/frontier state remains Decision Engine output;
- a selected outcome is shown only when authoritative state actually contains one;
- USER confirmation applies only to the exact proposition it validly confirms;
- intent, evidence, and decision uncertainty remain distinguishable even when their user-facing wording is simple;
- consequential external action remains separately authorized.

A renderer may hide machinery. It may not hide or rewrite these distinctions when doing so would materially change meaning.

## 7. Consequential explanation

`Why this matters` is one possible Composer presentation pattern when causal explanation is useful.

It is not required permanent chrome. When used, the explanation should be direct and plain-language rather than hidden behind abstract navigation.

Consequential explanation may connect a fact to a USER need, but it must not convert relevance into a new USER preference or convert USER preference into fact.

## 8. Resources

A resource is Composer content when it materially helps the person's current need.

Examples include directions, prepared messages, contact information, checklists, source documents, video, maps, images, calendar information, or generated artifacts.

Do not turn ordinary conversational operations such as Compare, Explain, Why?, or Details into permanent controls.

A substantial resource may take over the Composer while Conversation and the conversation input remain available. One quiet Back action restores the prior Composer composition.

A resource's existence does not itself establish that its factual content, recommendation, or action is licensed for the current semantic basis.

## 9. Behind-the-curtain inspection

Criteria, rationale, assumptions, evidence, sources, verification, provenance, and audit identifiers may be presented through the Composer when intentionally requested.

They do not occupy a permanent primary-screen slot and do not compete with the information ordinary users need.

Inspection presentation remains subordinate to the semantic owner of the underlying state.

## 10. Content adaptation rule

The renderer receives semantic presentation state and chooses Composer content by user meaning, authoritative basis, current usefulness, and content-specific licensing rather than by domain-specific hard-coding or fixed presentation stages.

Avoid treating `Clarifying`, `Investigating`, `Recommendation`, `Actionable`, or similar labels as universal presentation states.

Domain-specific renderers may exist inside the Composer when their content genuinely helps the person. They must not redefine the primary interaction model or collapse semantic distinctions for convenience.

## 11. Responsive law

Desktop and mobile preserve the same order:

1. Conversation;
2. conversation input;
3. Composer.

The Composer remains the dominant visual area.

Desktop may increase readable width and whitespace. Mobile may tighten spacing and typography. Neither may introduce a different navigation model, clipped leading conversation text, two-dimensional scrolling, or abstract controls required for core understanding.

## 12. Visual direction

The visual register is a quiet consultation surface, not a generic chatbot or decision dashboard.

Use the established neutral Solandra palette, restrained indigo accent, readable humanist typography, and hierarchy through whitespace and rules rather than stacked cards.

Do not introduce AI glow, orbit animation, confidence gauges, dashboard tiles, decorative source-count graphics, or workflow-state chrome.

Visual prominence must not manufacture semantic authority: a larger card, stronger type, or first position cannot turn a frontier option into a winner.

## 13. Universal discard test

Before adding any UI element, ask:

1. Does it help the person converse with Solandra?
2. Does it make the Composer more useful for understanding, deciding, or acting?
3. Does it preserve the authority of the state it presents?

If the first two answers are no, the element does not belong in the universal primary UI. If the third answer is no, the design is non-conforming regardless of convenience.

Also reject a design if:

- the text input is called or treated as the Composer;
- pending interpretation is presented as accepted USER meaning;
- an understanding summary remains permanently dominant when other information is more useful;
- the person must learn a command or presentation sequence to make Solandra advance;
- fixture-specific structure becomes universal architecture;
- technical machinery competes with useful information;
- a multi-option frontier is visually collapsed into a fabricated winner;
- uncertainty domains collapse into one generic confidence state;
- a fixed user-facing presentation-phase taxonomy or global content gate is introduced;
- mobile changes the hierarchy or hides critical Composer content.
