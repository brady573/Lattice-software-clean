---
version: alpha
name: "Lattice / Solandra"
description: "A quiet consultation where Conversation stays natural and the Composer adapts to the most useful trustworthy information now."
colors:
  canvas: "#F7F8FA"
  surface: "#FFFFFF"
  ink: "#171923"
  inkMuted: "#656976"
  line: "#D8DBE3"
  solandra: "#5146D8"
  verified: "#167263"
  caution: "#916313"
  danger: "#A94755"
  focus: "#2F6FEB"
  selection: "#ECEBFF"
typography:
  sans:
    fontFamily: 'IBM Plex Sans, Segoe UI, system-ui, sans-serif'
    fontSize: "1rem"
    lineHeight: "1.55"
  mono:
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace'
    fontSize: "0.8125rem"
    lineHeight: "1.45"
rounded:
  DEFAULT: "0.625rem"
  sm: "0.375rem"
  md: "0.625rem"
  lg: "0.875rem"
---

# Lattice / Solandra Design System — Offline Prototype

Status: **OWNER-APPROVED PRODUCT DESIGN — OFFLINE PROTOTYPE SCOPE**  
Approval date: 2026-08-26; primary interaction reconciled 2026-08-31 and subsequently corrected to retire the fixed presentation-phase/global-gate model.

`PRIMARY-INTERACTION-CONTRACT.md` controls the primary interaction. `../Lattice-Intent-and-Decision-Architecture.md` constrains semantic presentation of USER meaning, evidence, recommendation, selection, confirmation, and uncertainty. This file defines the visual and component vocabulary only.

## Creative north star

A **shared consultation screen** beside a skilled expert.

Solandra converses naturally with the person and uses the Composer to place the most useful currently licensed information in front of them. Clarification, research, explanation, comparison, recommendation, correction, resources, and action support may coexist as the situation requires rather than being forced through a fixed visual sequence.

The interface should feel calm, deliberate, and useful. It must not resemble an operator console, research dashboard, generic chatbot, analytics shell, workflow stepper, or visualization puzzle.

Signature interaction: **Adaptive Composer** — one stable shared visual surface continuously changes its composition according to user need, authoritative Product state, and current usefulness. Adaptive Composer behavior is presentation only; it creates no semantic authority.

## Core vocabulary

- **Conversation** — the narrative exchange with Solandra.
- **ConversationInput** — free-form text-entry/send control.
- **ComposerSurface** — the dominant shared visual information surface.
- **AcceptedUnderstanding** — faithful presentation of canonical accepted USER meaning when useful.
- **PendingInterpretation** — proposed USER meaning still awaiting required Intent Authority resolution.
- **UnderstandingSummary** — user-readable composition that may include accepted meaning plus clearly distinguishable pending interpretation.
- **IntentUncertaintyPresentation** — unresolved USER meaning rendered in plain language.
- **EvidenceUncertaintyPresentation** — unresolved external-world evidence/truth rendered in plain language.
- **DecisionUncertaintyPresentation** — unresolved decision-support state rendered in plain language.
- **FindingPresentation** — supported factual or analytical information licensed by the applicable Product authority.
- **RecommendationPresentation** — faithful presentation of Decision Engine recommendation/frontier state; not inherently a winner.
- **ConsequentialReason** — plain-language explanation of why something matters without converting relevance into USER preference or fact.
- **ContextualResource** — map, document, contact, media, checklist, prepared message, generated artifact, or other useful material.
- **EvidenceDetail / VerificationDetail** — deeper information presented only when useful or intentionally requested.
- **RecoveryAction** — plain-language failure/retry information.

These are rendering capabilities, not a sequence the user must traverse.

Do not use `ClarifyingPanel`, `InvestigationState`, `RecommendationState`, `ActionableStep`, or other workflow labels as universal primary components.

Do not use a single generic `MaterialUncertainty` or `Confidence` component in a way that erases whether the uncertainty belongs to intent, evidence, or decision semantics.

## Authority law

**Lattice owns meaning. Solandra owns presentation composition. The client owns rendering.**

Authority flows conceptually:

```text
USER expression / provenance
  -> Lattice Intent Authority
  -> exact DecisionPlan / Run basis
  -> V36 authoritative truth
  -> Lattice Decision Engine / StructuredDecision
  -> Solandra presentation projection
  -> semantic UI read model
  -> client rendering
```

No downstream layer may strengthen upstream state.

In particular:

- pending interpretation does not become accepted USER intent because it is displayed;
- model prose does not establish recommendation authority, Product truth, or execution authority;
- accepted USER meaning does not itself establish external facts or recommendation state;
- visual ordering does not turn a material-dominance frontier into a selected winner;
- generic USER agreement does not become broad semantic or action authorization;
- merely showing content in Composer does not make that content authoritative.

The client must not decide eligibility from raw values, choose/reconstruct a winner, derive truth from source count, convert `UNVERIFIED` into false or true, change a hard requirement into a preference, generate unsupported factual explanation, map provider confidence into Lattice truth confidence, or visually rescue an ineligible option through score.

## Visual system

Neutral surfaces dominate. Indigo (`solandra`) is a restrained relationship/accent color, never an “AI magic” or truth indicator. Verified/caution/danger are semantic and always paired with text or structure. No material state depends on color alone.

Use one humanist sans system for Conversation and Composer knowledge. IBM Plex Sans is preferred; the current offline implementation may use the approved system substitute (`Segoe UI`, `system-ui`).

Raw normalized scores and generic confidence meters are not default UI.

Visual emphasis must not imply stronger semantic authority than the underlying state provides.

## Layout

The locked geometry is:

- compact horizontal Conversation at the top;
- ConversationInput directly below it;
- ComposerSurface filling the remaining consultation viewport.

ComposerSurface content changes according to usefulness and exact Product state. It is not permanently an understanding panel and it is not a dashboard container.

Desktop may increase readable width and whitespace but must not become a multi-column dashboard. Mobile preserves the same order with no clipped or overlapping primary content.

## Hierarchy

Hierarchy comes primarily from typography, whitespace, thin rules, and semantic order.

Avoid blanket card grids, shadows on every object, glass/blur decoration, permanent evidence panels, provider/task widgets, workflow-state chrome, orbit controls, and unused placeholders for future content.

The most useful currently licensed content should be visually dominant. Accepted USER meaning can be prominent when it helps the conversation; a supported finding, comparison, recommendation frontier, warning, plan, or Resource can become dominant immediately when that is more useful. One kind of content does not have to wait for another presentation category to finish.

If Decision Engine state contains several materially distinct frontier options, hierarchy may help the person understand the trade-off but must not fabricate a selected winner.

## Content rules

Prefer plain, consequential language.

Avoid machinery language, source-count trust language, raw-confidence percentages, raw criterion keys, implementation classifications, and provenance IDs in the primary consultation.

Conversation and Composer should not repeat each other without distinct user value.

When a material correction changes the accepted basis, stale dependent Composer content must be retired or reconsidered.

When confirming pending USER meaning, presentation must make the exact proposition clear enough for the owning Intent Authority semantics; a broad understanding screen is not automatically a bulk semantic confirmation control.

Do not withhold already-valid useful information merely because unrelated clarification, research, or decision work remains incomplete. Conversely, do not strengthen incomplete work into established fact, recommendation, selection, or action authority simply because the UI has space to show it.

## Motion and updates

Motion explains transformation or disclosure only. No perpetual ambient animation. Respect reduced-motion preferences.

Incoming updates must not force-scroll a person who deliberately moved away from the newest Conversation content.

## Prototype implementation decision

For the approved offline vertical slice, the frontend stack is zero-dependency browser HTML/CSS/JavaScript served by the existing Fastify application. This does not alter Product authority semantics.

Topic-specific examples remain fixtures rather than universal architecture. Any fixture that displays facts, recommendations, frontier options, or a selected outcome must have a matching authoritative fixture basis rather than relying on persuasive copy alone.

## Component discard rule

A component belongs in the primary Solandra UI only if it materially helps Conversation or makes the Composer more useful for understanding, deciding, or acting, while preserving the semantic authority of the state it presents.

Otherwise, remove it from the primary surface.
