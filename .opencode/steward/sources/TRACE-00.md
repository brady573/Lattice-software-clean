# TRACE-00 — Shared Routing & Evidence Trace

> Draft shared Project Source.

## Purpose

Expose observable routing, evidence, authority, and handoff provenance without exposing private chain-of-thought.

## Commands

### `/trace route`
Show:
- request classification;
- role-specific sources loaded;
- shared sources materially applied;
- considered-but-not-material sources when useful;
- unavailable required sources;
- routing ambiguity.

### `/trace evidence`
Show:
- governing Owner/Core authority;
- KNOWN / CLAIMED / INFERRED / UNKNOWN / DECISIVE_UNKNOWN facts;
- revision/canonicality identifiers;
- evidence gaps affecting the result.

### `/trace handoff`
Show:
- upstream directive or acceptance basis;
- current candidate/canonical surface;
- downstream evidence or handoff expected;
- unresolved authority boundary.

### `/trace full`
Combine the above and add finding-to-source provenance.

## Invariants

- Never expose hidden chain-of-thought or private scratch work.
- Do not claim an unloaded source was applied.
- Do not load extra sources merely to make the trace look comprehensive.
- Trace observable mechanics and evidence, not latent reasoning.
