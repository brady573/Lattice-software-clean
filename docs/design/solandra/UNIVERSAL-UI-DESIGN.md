# Solandra Universal Primary UI Design

Status: **OWNER-APPROVED DOMAIN-INDEPENDENT UI — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

`../The-Core-Lattice-Philosophy.md` remains unchanged and highest Product authority. This UI design is subordinate to the Core and current Owner decision OD-011.

## 1. Universal design law

The UI is organized around the person's evolving need, not around a domain, candidate type, backend object, provider, workflow, or formal decision schema.

The universal frame remains:

1. Conversation
2. ConversationInput
3. Composer

## 2. Universal cognition

Solandra may naturally:

- interpret;
- clarify;
- investigate;
- explain;
- reason;
- compare;
- recommend;
- prepare Resources/actions;
- coordinate capabilities;
- follow up on execution/verification.

The UI should not expose a fixed taxonomy for those activities.

## 3. Universal trust distinctions

Across domains, preserve:

- conversation vs canonical Intent;
- information vs governed Knowledge;
- Knowledge vs Recommendation;
- Recommendation vs ActionProposal;
- ActionProposal vs Authorization;
- Authorization vs Execution;
- ExecutionReceipt vs Verification;
- presentation vs authority.

A domain-independent renderer may hide implementation machinery, not these consequences when they materially affect what the person can trust or do.

## 4. Composer content patterns

Universal useful patterns include:

- understanding/tentative interpretation;
- Knowledge/finding;
- uncertainty/limitation;
- Recommendation/alternatives;
- formal frontier/tie when an optional formal capability was actually used;
- warning/plan;
- Resource;
- source/evidence inspection;
- ActionProposal/authorization;
- execution/verification/recovery state.

No pattern is mandatory for every consultation.

## 5. No universal Decision Engine assumption

The UI must not assume every conversation has:

- candidates;
- criteria;
- scores;
- frontier;
- a winner;
- formal Decision Engine state.

Ordinary Recommendation may be natural advisory reasoning over governed Intent and Knowledge.

When formal state exists, render it faithfully. When it does not, do not manufacture formal semantics merely for UI consistency.

## 6. References are natural, not object-picker UI

ConversationReference should normally remain invisible infrastructure for natural phrases such as:

- “that”;
- “the second one”;
- “those sources”;
- “do it.”

Expose object/provenance detail only when useful or requested.

## 7. Resources and action

A Resource may take over Composer. ActionProposal/Authorization/Verification may appear when materially useful.

Do not turn ordinary operations (`Compare`, `Explain`, `Why?`, `Sources`, `Do it`) into permanent controls required for Product progress.

## 8. Responsive law

Desktop and mobile preserve the same hierarchy: Conversation, input, Composer. Mobile does not introduce a different workflow or hide material trust/action state.

## 9. Visual direction

Maintain the quiet consultation register. Avoid generic chatbot/dashboard aesthetics, technical machinery, confidence theater, or visual treatments that imply unsupported authority.

## 10. Universal discard test

Reject a design if it:

- forces a domain schema into the universal frame;
- treats pending interpretation as canonical Intent;
- treats raw information as Knowledge;
- requires formal Decision Engine state for ordinary Recommendation;
- collapses Recommendation into action authority;
- treats execution success as Verification;
- requires stage navigation/hidden commands;
- exposes provider/worker/Run mechanics without user benefit;
- makes mobile/accessibility materially worse.
