# Trustworthy Knowledge Consultation v0.1

This capability gives canonical Solandra consultations an explicit, zero-cost live development path for external Knowledge work. It does not make a source provider authoritative, does not require a DecisionPlan, and does not qualify a production provider.

## Reproducible live proof

Run from a clean checkout with Node 24 and npm 11:

```bash
npm ci
npm run proof:knowledge:live
```

The proof asks `What causes ocean tides?` through the canonical conversation API, waits for the Run and V36 validation, inspects the `KnowledgeOutcome`, then asks `Show me the sources.` in the same conversation. It fails unless:

- authoritative intent is established from the original question;
- Wikimedia returns real external source material;
- V36 admits at least one exact source-bound report;
- broader mandatory proof obligations remain unresolved unless their semantics are actually established;
- provenance, evidence, and uncertainty survive into the outcome;
- Solandra's authoritative presentation read model contains the accepted understanding and supporting knowledge;
- the follow-up preserves the objective and IntentVersion while broadening the actual retrieval;
- no DecisionPlan exists for either Knowledge Run.

Set `LATTICE_LIVE_PROOF_QUESTION` to exercise another general factual question. Do not use this command as a deterministic CI gate: it deliberately depends on a public network service whose availability and search results can change.

## Follow-up capability boundary

The v0.1 live acquisition path supports source retrieval and source expansion. Subject expansion can alter current investigation without replacing canonical intent when the USER has not explicitly corrected the objective.

`Why?` / `Explain` is limited to additional source-grounded retrieval. It is not a model-synthesized explanation. Genuine language simplification and semantic contradiction detection are unsupported in v0.1 and must be surfaced as limitations rather than simulated through truncation or broader `SUPPORTS` retrieval.

## Authority and limitations

The Wikimedia adapter retrieves source identity, source text, timestamps, and exact source-bound claim proposals. Every artifact is initially untrusted. V36's conservative admission policy verifies content/source integrity and can support the narrow statement that the retrieved source reports the excerpt. It does not independently establish every wider real-world claim contained in that excerpt.

The v0.1 explanation is therefore extractive. It has inspectable provenance and honest uncertainty, but no model-generated synthesis, genuine language simplification, independent multi-provider corroboration, semantic contradiction detector, or production service-level guarantee. Provider failure produces unresolved knowledge rather than invented fallback prose. Deterministic tests use replaceable acquisition fixtures and do not require the network.
