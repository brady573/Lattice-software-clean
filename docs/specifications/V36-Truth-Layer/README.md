# V36 Truth Layer — Prototype Architecture Contract

Status: **Owner-approved implementation target for repository integration; production deployment and live-provider execution are not authorized by this document.**

Source package SHA-256: `1752231d1471d8f1407a00e071c68983d2db822846e7411c30e680b2c4e831c0`  
Package baseline: `c994a7ba4c6df97c9a086dabc249c0a7235803b0`  
Reconciliation baseline: `8a84087ef8f69d4317a136ea04c7935559e31e38`

## Prototype conformance target

The prototype must implement V36 Work Items WI-1 through WI-10 as executable deterministic architecture. WI-11 is limited to provider-neutral interfaces and an offline fixture provider. Live-provider execution and live-provider validation remain dormant until a later qualified Work Item.

The machine-readable `claim-proof-contracts.json` in this directory is the exact proof-obligation contract. The prose architecture table is descriptive; where it abbreviates a row, the machine-readable contract controls the exact obligation list.

## Bound invariants

- Persisted structured evidence state is authoritative; generated prose is downstream.
- Every material assertion is typed before proof obligations are evaluated.
- Proof obligations are deterministic by claim type.
- Source count, model agreement, and repeated rediscovery do not establish independence.
- Provenance components, source derivation edges, artifact hashes, content similarity, evidence-effective dates, and research-question lineage are retained.
- Rejected, unresolved, mixed, or outdated material evidence cannot satisfy a hard constraint as established fact.
- Ordinary positive claims require a strong authoritative primary path or materially independent corroboration.
- Causal/authenticity positives require materially independent corroboration.
- Unsupported positive claims fail to `UNVERIFIED`, not `FALSE`.
- Verified conflict is surfaced as `MIXED`; the positive burden cannot erase contradictory evidence.
- Current-state evidence that fails temporal applicability is `OUTDATED`.
- Important/risky positive claims have a disconfirming route; blocking contradiction is itself verified.
- Missing required corroboration triggers bounded second-origin recovery.
- Independent research/proof tasks may run concurrently, but parallelism never changes proof meaning.
- Decision evidence IDs resolve to same-Run admitted material `TRUE` evidence.
- StructuredDecision is persisted before explanation generation.
- Explanation mismatch or unsupported extra material content blocks completion.
- Simulation calibration values remain implementation seeds only, not production epistemic constants.

## Prototype provider boundary

- `LATTICE_TRUTH_MODE=v36-offline`
- deterministic offline fixture research is allowed for Product tests;
- live research provider is explicitly dormant and fails closed if invoked;
- no provider confidence is mapped directly to Lattice truth confidence;
- no paid provider, production deployment, production database mutation, or secret change is authorized here.

## Exact-revision repository gates

```bash
npm ci --no-audit --no-fund
npm run build
npm test
npm run check
```

When PostgreSQL changes are present, the development PostgreSQL lane must pass against the exact candidate revision. Passing repository gates is not sufficient while any bound V36 offline Product acceptance criterion is failing.
