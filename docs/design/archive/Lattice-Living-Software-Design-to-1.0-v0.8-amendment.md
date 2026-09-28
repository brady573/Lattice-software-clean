# Lattice Living Software Design to 1.0 — v0.8 Amendment

Status: **OWNER-APPROVED PRODUCT DESIGN AMENDMENT**  
Approved: **August 31, 2026**  
Scope: **Solandra primary interaction and presentation direction only**

## 1. Decision

The former fixed Solandra presentation-stage model and its global presentation-readiness gate are retired from current Lattice Product direction.

Current Solandra interaction is one continuous conversation built on the stable primary frame:

```text
Conversation
ConversationInput
Composer
```

The Composer adapts continuously to the most useful information that is currently valid to present. Clarification, information gathering, explanation, comparison, recommendation, correction, Resource use, evidence inspection, and action support are ordinary conversational activities and content forms. They are not a required user-facing sequence.

## 2. Supersession effect

Any earlier Living Design, amendment, roadmap, Solandra design, approval-adaptation, prototype, or coordination text that requires:

- a fixed user-facing presentation-stage taxonomy;
- a mandatory sequential transition among presentation categories;
- a single global threshold that must be crossed before useful information can become primary;
- an understanding-first Composer state that must remain active solely because unrelated research or decision work is incomplete; or
- UI/navigation behavior whose purpose is to expose or control such a stage model

is **SUPERSEDED for current Product direction** by this amendment and the current `docs/design/solandra/PRIMARY-INTERACTION-CONTRACT.md`.

Historical documents and immutable package archives may retain the older wording as provenance. Their presence does not restore that behavior as a current requirement.

## 3. What remains unchanged

This amendment changes presentation interaction only. It does not weaken or transfer semantic authority.

- **Lattice Intent Authority** still owns accepted USER meaning, clarification/confirmation, and correction lineage.
- **V36 Truth Core** still owns external factual evidence/truth admission.
- **Lattice Decision Engine** still owns eligibility, comparison, recommendation/frontier state, selected-outcome semantics, and `StructuredDecision`.
- **Lattice Execution Runtime** still owns durable operational execution and recovery.
- **Resource/Action architecture** still owns Resource validity, provenance, prepared-action state, and execution separation.
- Consequential action remains subject to applicable authorization boundaries.
- Solandra remains presentation/interaction and may not strengthen upstream Product state.

No presentation change, model prose, visual emphasis, or Composer placement can establish accepted intent, factual truth, recommendation authority, selected-outcome authority, or execution authorization.

## 4. Continuous useful presentation

There is no global presentation gate that determines when Solandra is allowed to be useful.

Instead, every material piece of information is governed by its own semantic basis.

Examples:

- Solandra may ask a material clarification while the Composer shows an already-valid map or document.
- A supported factual finding may become primary while a separate question is still being researched.
- Accepted USER meaning may remain visible beside or beneath other useful content when it helps the person interpret that content.
- A decision frontier may be presented while an unresolved evidence gap is shown as a limitation on stronger selection.
- A substantial Resource may take over the Composer whenever it is the most useful thing to show.

Already-valid information does not need to be withheld because unrelated work remains incomplete. Incomplete work may not be promoted into authoritative content merely to make the presentation cleaner.

## 5. Current maintenance homes

The current Solandra presentation direction is maintained in:

- `docs/design/solandra/PRIMARY-INTERACTION-CONTRACT.md` — controlling interaction rule;
- `docs/design/solandra/CONVERSATION-FLOW.md` — continuous conversation, clarification, information gathering, content licensing, uncertainty routing, and reversal;
- `docs/design/solandra/UI-DESIGN.md` — concrete composition behavior;
- `docs/design/solandra/UNIVERSAL-UI-DESIGN.md` — domain-independent rules;
- `docs/design/solandra/BASELINE-LAYOUT-INVARIANTS.md` — geometry;
- `docs/design/solandra/DESIGN.md` — visual/component vocabulary; and
- `docs/design/solandra/ACCEPTANCE.md` — black-box acceptance intent.

These presentation documents remain subordinate to the semantic Product authorities at their applicable boundaries.

## 6. Anti-drift rule

A future design has drifted if it reintroduces a fixed user-facing presentation-stage sequence or global content-readiness gate as the organizing model for ordinary Solandra interaction.

The stable design question is:

> **What is the most useful trustworthy thing for this person to see in the Composer right now?**

The answer may change continuously as USER meaning, evidence, decision state, Resources, and the conversation evolve.
