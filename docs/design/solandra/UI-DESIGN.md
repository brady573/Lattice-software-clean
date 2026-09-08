# Solandra Primary UI Design

Status: **OWNER-APPROVED PRIMARY UI — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

`../The-Core-Lattice-Philosophy.md` remains unchanged and highest Product authority. This UI design is subordinate to the Core and current Owner decision OD-011.

## 1. Screen anatomy

The stable primary frame remains:

```text
Conversation
ConversationInput
Composer
```

The Composer is the dominant shared visual surface. It is not the text-entry box.

Responsive geometry remains governed by `BASELINE-LAYOUT-INVARIANTS.md`.

## 2. Solandra's role in the UI

The experience may correctly feel as though Solandra understands, investigates, reasons, recommends, coordinates help, and prepares action—because those are now part of Solandra's cognitive role.

The UI still preserves Lattice trust distinctions:

- Solandra interpretation may be tentative;
- canonical Intent is Lattice Intent Integrity state;
- established factual support is governed Knowledge;
- ordinary Recommendation is advisory Solandra state over governed basis;
- optional formal Decision Engine output retains its formal status when used;
- Recommendation is not Authorization;
- execution success is not automatically Verification.

## 3. Conversation and Composer coordination

Conversation handles the human exchange. Composer shows information that benefits from persistence, structure, comparison, spatial organization, media, provenance inspection, or actionability.

The Composer should not narrate internal provider/model/Run/worker/task stages. Labels should describe useful content, not machinery.

## 4. Adaptive Composer content

Composer may prioritize:

- accepted understanding;
- tentative interpretation;
- governed Knowledge/finding;
- uncertainty/limitation;
- Recommendation/alternatives;
- optional formal comparison/frontier;
- plan;
- Resource;
- sources/evidence;
- ActionProposal/authorization summary;
- execution/verification/recovery state.

These are content patterns, not mandatory UI modes.

## 5. Recommendation presentation

Ordinary Recommendation does not require a formal Decision Engine badge or structure.

Show the useful recommendation, material reasons, assumptions, alternatives, and uncertainty appropriate to the basis.

If a formal capability was used and produced a frontier/tie/unresolved result, preserve that exact shape. Visual hierarchy cannot fabricate a formal winner.

## 6. Source/provenance presentation

When the person asks for sources behind prior advice, present the actual stored provenance used by that Knowledge/Recommendation.

Distinguish:

- sources used for the original answer;
- newly acquired sources from a later investigation.

Do not imply retroactive support.

## 7. Referential follow-ups

The UI need not expose raw ConversationReference IDs. It should make natural referents work:

- “that”;
- “the second option”;
- “those sources”;
- “do it.”

When ambiguity is material, Solandra asks naturally. Do not require the user to select internal object IDs.

## 8. Action presentation

Prepared action content may appear as a Resource or ActionProposal.

When Authorization is needed, show the exact consequential action in ordinary language with enough target/scope detail for meaningful consent.

Do not make Authorization a generic approval of the whole Composer.

After execution, distinguish:

- reported execution/receipt;
- verification in progress;
- verified resulting state;
- ambiguous/unverifiable state.

## 9. Resource takeover

A substantial Resource may become Composer's active content. Conversation and ConversationInput remain available. One quiet Back action restores prior composition.

Opening/closing a Resource does not change Intent, Recommendation, Authorization, or Verification by itself.

## 10. Failure/recovery presentation

Keep the last trustworthy composition when useful. Explain Product consequence and safe next action, not raw provider/worker/database detail.

Do not display “completed” as verified when only an ExecutionReceipt exists and verification has not established the result.

## 11. Responsive and accessibility rules

The most useful Composer information remains primary at supported widths/zoom.

Preserve:

- keyboard reachability;
- visible focus;
- text/non-color material-state cues;
- reduced-motion behavior;
- IME-safe input;
- no two-dimensional page scrolling for core UI;
- no clipping/overlap of Conversation, input, Composer, or active Resource.

## 12. Visual direction

Preserve the quiet consultation visual system:

- neutral surfaces;
- restrained indigo relationship accent;
- readable humanist typography;
- hierarchy through whitespace/type/rules;
- no AI glow, provider dashboards, confidence gauges, workflow-stage chrome, orbit controls, or card proliferation.

Visual emphasis may improve comprehension. It may not increase semantic authority.

## 13. Discard test

Reject permanent primary UI that does not materially help Conversation or make Composer more useful.

Also reject UI that:

- makes the person manage backend machinery;
- requires formal-decision structure for ordinary advice;
- hides a material authorization/verification distinction;
- duplicates content without benefit;
- turns an understanding summary into permanent dominant chrome;
- introduces fixed stage navigation or hidden capability commands.
