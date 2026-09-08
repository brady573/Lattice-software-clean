# Solandra Conversation Flow and Composer Contract

Status: **OWNER-APPROVED CONTINUOUS INTERACTION — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

`../The-Core-Lattice-Philosophy.md` remains unchanged and highest Product authority. This contract is subordinate to the Core and current Owner decision OD-011.

`PRIMARY-INTERACTION-CONTRACT.md` controls interaction conflicts. Current cognition/trust semantics are defined by OD-011 and the cross-system architecture documents.

## 1. Mental model

The person talks naturally with Solandra. Solandra interprets the conversation, reasons about what matters, gathers or requests Knowledge when useful, recommends when useful, and coordinates capabilities/action preparation when useful.

The Composer is the shared visual surface for the most useful trustworthy information now.

## 2. Ordinary cognitive loop

Conceptually:

```text
new USER turn
 -> resolve conversation refs/context
 -> update Solandra semantic hypothesis
 -> check Intent Integrity implications
 -> identify useful Knowledge/capability work
 -> reason over governed state
 -> respond / Recommendation / Resource / ActionProposal as useful
 -> persist ConversationReference to governed objects
```

This is not a fixed user-visible stage sequence.

## 3. Understanding and clarification

Solandra continuously maintains probable objective, constraints/preferences, entities/referents, and material ambiguity.

Accepted canonical meaning remains distinct from Solandra's interpretation.

Clarify only when ambiguity is materially consequential to truth, Recommendation/formal decision, or consequential action. Already-valid useful information may remain visible while clarification occurs.

## 4. Knowledge gathering

Solandra may identify information the person did not know to request when it can materially improve usefulness, correctness, or actionability.

The governing question is:

> **What Knowledge would materially change or strengthen what I can responsibly tell or help this person do?**

Capability acquisition produces information/provenance. Lattice Knowledge Trust/V36 establishes governed Knowledge.

Information gathering can occur concurrently with useful conversation; no dedicated research screen is required.

## 5. Reasoning and Recommendation

Solandra reasons over exact governed Intent + Knowledge + known uncertainty.

She may:

- compare alternatives;
- identify assumptions/trade-offs;
- test preference sensitivity;
- recognize when more Knowledge matters;
- produce an advisory Recommendation;
- explain why the Recommendation follows.

Ordinary advice does not require the formal Decision Engine.

When a formal algorithm materially helps, Solandra may invoke it as a capability and must preserve the formal result's semantics.

## 6. Uncertainty routing

Keep uncertainty domains separate:

- **Intent uncertainty** -> Solandra + Intent Integrity clarification.
- **Knowledge/evidence uncertainty** -> Knowledge Trust/V36 or explicit limitation.
- **Recommendation uncertainty** -> Solandra preserves assumptions/conditionality/no-responsible-recommendation state.
- **Formal decision uncertainty** -> optional formal capability's own qualified semantics.
- **Execution uncertainty** -> ExecutionReceipt/recovery state.
- **Verification uncertainty** -> Verification boundary.

Do not collapse all of these into one confidence score.

## 7. Governed referential continuity

ConversationReference enables natural follow-ups without reconstructing authority from text.

### Explain that

Resolve the most plausible referenced governed object. Explain from its exact basis.

### What were your sources?

Traverse the referenced Knowledge/Recommendation's actual historical provenance:

```text
Recommendation? -> Knowledge -> Evidence -> Source
```

Do not perform a new search and claim newly found sources were the old answer's support.

### What about the second option?

Resolve the exact referenced alternatives/recommendation/formal result. Preserve its original basis; if new Knowledge is acquired, distinguish the new analysis from the old one.

### Do it

Resolve the exact referenced ActionProposal if one exists and remains current. Otherwise prepare a new exact ActionProposal from the referenced Recommendation/Resource.

Then apply Authorization rules. “Do it” is context for authorization, not a bypass around the action trust boundary.

### Did it work?

Resolve the exact operation's ExecutionReceipt and Verification. If independently verified state is unavailable, say so rather than treating executor success as verified reality.

## 8. Correction and reversibility

A material USER correction creates successor Intent state and may invalidate dependent Knowledge requests, Recommendations, formal decision inputs, Resources, or ActionProposals.

Unaffected governed objects may remain useful. Historical objects remain intact.

## 9. Conversation input

Preserve current mechanics:

- free-form text;
- Enter sends only when IME composition inactive;
- Shift+Enter newline;
- bounded textarea growth;
- duplicate send disabled for unresolved logical turn where applicable;
- no silent auto-send/queueing of later draft text;
- failure preserves transcript/draft/trustworthy Composer state;
- async response does not force the mobile keyboard open.

Input hints must not encode hidden commands required for Product capability.

## 10. Composer coordination

Conversation asks/frames/explains. Composer provides persistent/structured/visual material when that helps.

Avoid duplicating the same prose in both surfaces without distinct value.

A Resource or source/verification inspection may take over Composer while Conversation remains available.

## 11. Acceptance fixtures

Representative observable fixtures should include:

- ordinary language interpreted without ritual confirmation;
- materially ambiguous consequential meaning causing precise clarification;
- Knowledge gathered about a fact the USER did not know to ask for;
- ordinary Recommendation without formal Decision Engine use;
- optional formal comparison preserving frontier/tie semantics;
- “Explain that” resolving exact prior Recommendation;
- “What were your sources?” using actual historical provenance without re-search attribution;
- “What about the second option?” resolving exact referent;
- “Do it” resolving/preparing exact ActionProposal and requiring missing Authorization;
- “Did it work?” distinguishing ExecutionReceipt from Verification;
- correction invalidating only dependent state;
- resource takeover/return;
- reconnect preserving governed references.

Fixture nouns/order/turn count are examples, not Product schema.
