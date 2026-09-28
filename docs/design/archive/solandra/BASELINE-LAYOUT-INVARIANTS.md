# Solandra Baseline Layout Invariants

Status: **OWNER-APPROVED PRODUCT UI LAYOUT LOCK**  
Approval basis: the Owner-locked baseline handoff plus the 2026-08-31 Composer-concept reconciliation and later removal of the fixed presentation-phase model.

This document constrains geometry only. `PRIMARY-INTERACTION-CONTRACT.md` controls interaction semantics.

## 1. Stable frame

The universal primary layout is:

```text
Solandra header

compact horizontal Conversation strip
conversation input immediately below Conversation

Composer filling the remaining consultation viewport
```

The Composer is the shared visual information surface. It is not the textarea and it is not synonymous with an understanding summary or any one content type.

## 2. Composer geometry

The Composer is the dominant spatial region.

- It occupies the remaining bounded viewport area.
- It presents one coherent composition at a time.
- It may center concise USER meaning, present findings or decision support, or render a substantial resource.
- Its internal layout may adapt to content length, media type, accessibility reflow, or device height.
- It must not become a dashboard, card grid, permanent resource shelf, or multi-column workspace simply because more information is available.

## 3. Adaptive composition

The same Composer area supports the entire continuous conversation.

Composer content may include accepted USER meaning, pending interpretation when useful, material uncertainty, findings, comparisons, recommendation/frontier state, explanations, plans, warnings, Resources, or intentionally requested inspection detail.

No permanent lower-edge section, `Details` slot, `Why this matters` control, candidate tray, workflow indicator, or resource row is required by the frame. Such content appears only when it is useful inside the Composer.

Geometry does not create semantic or transition authority. `PRIMARY-INTERACTION-CONTRACT.md`, `CONVERSATION-FLOW.md`, and the owning Product authority determine what content is valid to present.

## 4. Conversation geometry

Conversation remains compact rather than consuming the main page height.

- History may be horizontally navigable.
- The current/latest relevant turn must be fully readable without accidental clipping.
- The conversation input remains directly below Conversation.
- Conversation and input must not expand until they crowd out the Composer during ordinary use.

## 5. Resource takeover

When a substantial resource is the most useful thing to show:

- Conversation and conversation input remain available above;
- the resource takes over the Composer;
- the previous Composer composition is hidden while the resource is active;
- one quiet Back action restores the prior Composer content;
- the resource owns any necessary internal scrolling.

Opening a resource is a presentation change, not a workflow transition or semantic-authority change.

## 6. Responsive preservation

Desktop and mobile use the same layout grammar.

Required invariants:

- no document-level horizontal overflow;
- no accidental document-level vertical overflow in the bounded primary consultation state;
- no clipped latest Conversation content;
- Conversation input remains usable;
- Composer remains the dominant visual region;
- substantial resources remain Composer-bounded;
- required controls remain usable at narrow widths and reduced motion;
- critical Composer content remains legible at 200% zoom/reflow.

Desktop may increase whitespace and readable measure. Mobile may reduce padding and type scale. Neither may reorder the application into a different architecture.

## 7. Anti-drift test

A future design or implementation has drifted if any of these become true:

1. The text-entry control is treated as the Composer.
2. Conversation becomes the dominant vertical page instead of a compact exchange region.
3. The conversation input is detached from Conversation.
4. The Composer no longer fills the remaining consultation viewport.
5. One content pattern, including an understanding summary, becomes permanently fixed as the main Composer content regardless of current usefulness.
6. A dashboard, card grid, multi-column workspace, conventional chatbot shell, orbit, or workflow stepper replaces the consultation geometry.
7. A fixed user-facing presentation-phase taxonomy or phase-navigation control becomes part of the primary frame.
8. Permanent `Details`, `Compare`, `Next`, resource-tray, or similar chrome occupies the Composer without current user value.
9. A substantial resource appears beside the normal Composer instead of becoming the Composer's active content.
10. Mobile introduces clipping, overlap, or page overflow that changes the hierarchy.

The structural reference is therefore **Conversation + conversation input + Composer**, with Composer content changing according to what is useful and licensed now.
