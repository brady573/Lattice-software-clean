# A1 — Trustworthy Knowledge spine

This implementation milestone is bounded by `docs/ROADMAP.md` and the Core Lattice Philosophy.

## Product behavior

- Canonical USER wording remains the authoritative objective.
- An unresolved three-letter short form in an initial Knowledge question triggers one concise clarification instead of a guessed expansion.
- The USER's clarification becomes non-authoritative investigation context while the accepted objective and IntentVersion remain unchanged.
- Operational query derivation may use that explicit clarification without allowing ordinary derived search terms to bypass existing multi-term relevance safeguards.
- Wikimedia is explicitly marked as `GENERAL_REFERENCE`; this metadata is carried into Knowledge provenance without becoming V36 truth authority.
- Tax/legal/regulatory-style answers require an explicitly `AUTHORITATIVE_DOMAIN` source suitability marker before Solandra will present the retrieved material as an answer.
- Solandra's ordinary Knowledge answer is extractive: factual answer text must come verbatim from governed findings. Conflict, insufficient source quality, absent evidence, or missing faithful explanatory text fail closed.
- `What are your sources?` returns the exact visible source titles, publishers, and canonical URIs.
- `Why?` reuses the authoritative objective and asks the existing investigation path for causal/mechanistic material.
- PR #15 simplification remains the only optional model transform and remains downstream, non-authoritative, and fail-closed.

## Authority boundaries

A1 does not change V36 admission or adjudication, Intent Authority, Decision, Authorization, execution, or the Model Gateway. Source suitability is Product presentation metadata, not a truth verdict. Generated/model output is never promoted to canonical Knowledge.

## Deterministic acceptance

`test/a1-trustworthy-knowledge-spine.test.ts` exercises the canonical HTTP consultation path for:

1. direct cast-iron causal answer with provenance;
2. TIC clarification plus unseen DSO terminology handling;
3. reversed causal relation rejection;
4. high-stakes source suitability;
5. material conflict preservation;
6. unresolved/no-evidence failure;
7. `Why?`, simplification, and source follow-ups.

The tests intentionally use deterministic acquisition fixtures. Existing PR #15 live model evidence remains applicable because A1 does not change its provider, model, prompt, runtime, or simplification guard.
