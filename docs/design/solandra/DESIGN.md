---
version: alpha-reconciled
name: "Lattice / Solandra"
description: "A quiet intelligent consultation where Solandra reasons naturally and Lattice preserves trust behind the conversation."
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

# Lattice / Solandra Design System

Status: **OWNER-APPROVED VISUAL SYSTEM — COGNITION/TRUST RECONCILED**

Reconciled: **2026-09-08**

`../The-Core-Lattice-Philosophy.md` remains unchanged and highest Product authority. This visual design is subordinate to the Core and current Owner decision OD-011.

`PRIMARY-INTERACTION-CONTRACT.md` controls interaction. Cross-system architecture controls cognition/trust semantics. This file owns visual/component vocabulary only.

## Creative north star

A **shared consultation screen beside a skilled intelligent expert**.

Solandra converses naturally, understands context, investigates/reasons when useful, and uses Composer to put the most useful trustworthy information in front of the person.

Lattice's trust machinery should feel dependable without making the interface resemble a compliance console, workflow engine, research dashboard, or provider monitor.

## Ownership law

> **Solandra owns ordinary cognition and human-facing composition. Lattice owns trust boundaries. Capabilities perform bounded work. The client renders.**

No visual layer may strengthen upstream trust state.

## Core vocabulary

- **Conversation** — interpersonal exchange.
- **ConversationInput** — free-form text input/send.
- **ComposerSurface** — dominant shared visual information surface.
- **AcceptedUnderstanding** — canonical Intent rendered when useful.
- **TentativeInterpretation** — Solandra interpretation not yet justified as canonical where material.
- **KnowledgePresentation** — governed Knowledge/finding.
- **SourceEvidencePresentation** — actual Knowledge provenance inspection.
- **RecommendationPresentation** — advisory Solandra Recommendation over governed basis.
- **FormalDecisionPresentation** — optional qualified formal result/frontier/tie when such a capability was used.
- **ContextualResource** — useful Resource.
- **ActionProposalPresentation** — exact prepared consequential action.
- **AuthorizationPresentation** — narrow requested/recorded authorization when materially user-visible.
- **ExecutionPresentation** — operational receipt/progress, not verification.
- **VerificationPresentation** — what Lattice can establish about resulting state.
- **RecoveryAction** — safe Product-level continuation/recovery guidance.

These are rendering capabilities, not stages.

## Visual system

Neutral surfaces dominate. Indigo remains a restrained relationship/accent color, never an AI-magic/truth indicator. Verified/caution/danger are semantic and paired with text/structure.

Avoid generic confidence meters, provider badges, source-count trust graphics, and raw internal IDs in ordinary Composer content.

## Layout

Preserve:

- compact Conversation;
- ConversationInput beneath it;
- ComposerSurface filling the remaining consultation viewport.

Desktop may add whitespace/readable measure. Mobile preserves order/hierarchy.

## Hierarchy

Hierarchy comes from typography, whitespace, rules, and content structure.

The most useful trustworthy content dominates. That may be understanding, Knowledge, Recommendation, Resource, ActionProposal, or Verification depending on the conversation.

Visual ordering cannot upgrade:

- tentative interpretation -> Intent;
- information -> Knowledge;
- Recommendation -> Authorization;
- formal frontier -> winner;
- ExecutionReceipt -> Verification.

## Content language

Prefer plain consequential language. Avoid machinery language unless intentionally inspecting diagnostics/provenance.

When an action needs Authorization, show what will happen, to what target, and material consequence in language a normal person can understand.

When execution has only been reported, avoid copy such as “verified complete” until Verification supports it.

## Motion and updates

Motion explains transformation/disclosure only. No perpetual ambient AI animation. Respect reduced motion.

Incoming updates must not steal focus or force-scroll a person who deliberately moved away from the newest content.

## Component discard rule

A component belongs in the primary UI only if it materially helps Conversation or makes Composer more useful while preserving the trust status of what it presents.
