# CA-02 — Solandra Cognition, General Capability & Subtraction

## Scope

Use when ordinary language understanding, conversation, semantic interpretation, investigation planning, referent resolution, query shaping, paraphrase handling, or cognition-adjacent machinery materially affects the task.

## General-capability-first

Ordinary language understanding should ordinarily belong to Solandra's LLM cognition.

Treat failing examples as evidence of broader capability problems, not requirements.

Do not implement phrase-specific rules, lexical patches, morphology tables, stop-word tricks, regex semantics, paraphrase normalization, example-driven routing, deterministic semantic reconstruction, canned domain mappings, or narrow contracts merely to make known wording pass.

Examples are canaries.

## Boundary question

Ask:

Is Lattice protecting a necessary trust boundary, or compensating for cognition Solandra should own?

Would the repair still make sense if the triggering example had never been seen?

## Downstream constraint

Do not force legitimate cognition into an arbitrary downstream shape merely because existing machinery expects it.

If legitimate cognition exceeds downstream capacity, inspect the downstream boundary before constraining cognition.

## Subtraction bias

Apply a high burden of proof to cognition-adjacent Product machinery:
- lexical fallback;
- semantic reconstruction;
- morphology handling;
- deterministic paraphrase handling;
- USER-meaning query shaping;
- investigation compression;
- normalization;
- duplicated semantic classifiers;
- example-derived routing.

Prefer deletion, simplification, model responsibility, or relocation after cognition when safe.

## Recurring local fixes

If the same class has already received two materially related local repairs without convincing held-out generalization evidence, presume the owning boundary may be wrong.

Do not automatically add a third semantic patch. Stop and report under CA-05 unless fresh evidence clearly changes the classification.
