# Specialist Guidance Prototype

Status: development-only prototype slice. This does not implement canonical Lattice Intent Authority. OD-004 design authority is resolved by the canonical v0.6 amendment; this slice intentionally remains on deterministic prototype IntentVersion fixtures while the current prototype boundary is in force.

Reconciled baseline: `main@c479258d449e505b94ddd8cc4e048ee803ede9dc`. Prior validated prototype head `46cd22a57db0eb34f05523e8cb555a8cff983d52` is preserved separately and its validation does not transfer to this reconciled revision.

## Placement

```text
Prototype IntentVersion fixture
        |
        v
Specialist Guidance Resolver
        |
        v
trusted budgeting-guidance@1
        |
        v
Specialist Guidance Compiler
        |
        v
Lattice Model Gateway / Windows-hosted local-model relay prototype
        |  (legacy Android prototype identifiers retained)
        v
Solandra local-model prototype
```

The fixture is deliberately labeled `specialist-guidance-prototype-fixture-v1`. It is test/prototype input only and must not be persisted or treated as canonical Intent Authority state.

## Trusted resource

- Profile: `budgeting-guidance@1`
- Resource: `src/specialist-guidance/resources/budgeting-guidance.v1.json`
- Schema: `src/specialist-guidance/resources/specialist-guidance-profile.schema.json`
- Hash algorithm: SHA-256
- Canonicalization: `lattice-json-v1` — UTF-8 JSON; object keys sorted lexicographically; array order preserved; no insignificant whitespace.
- Expected profile hash: `sha256:e40b85cb28796a20bd60dd061e650240f07e1f61b0c4ec2a44afdd0064cca233`

The hash is derived audit metadata rather than an embedded self-hash.

## Prototype resolver contract

The deterministic fixture shape is:

```json
{
  "fixtureSource": "specialist-guidance-prototype-fixture-v1",
  "intentVersionId": "prototype-budgeting-v1",
  "status": "confirmed",
  "primaryDomain": "personal_budgeting",
  "candidateDomains": ["personal_budgeting"],
  "specialistGuidanceEnabled": true
}
```

Resolution is zero-or-one:

- `personal_budgeting` primary domain + enabled -> `budgeting-guidance@1`;
- explicit opt-out -> none;
- unresolved primary domain -> none;
- unrelated primary domain -> none;
- missing trusted profile -> none.

Selection is reconstructed for every invocation. There is no mutable `activeProfile` state.

## Control/data separation

The compiler receives only the trusted profile resource. It does not interpolate USER, assistant, retrieved, provider, or fixture strings into the specialist control message. Dynamic transcript messages remain separate canonical model messages.

A profile cannot grant tools, permissions, data access, production authority, truth authority, Intent Authority, or Decision Engine authority.

## Solandra / local-model prototype exercise

The existing local-model page remains unchanged by default:

`/android-llm`

To exercise the deterministic budgeting fixture in the same prototype path:

`/android-llm?specialist=budgeting`

The page submits the explicit prototype fixture with each model turn. The server re-resolves it for that invocation, compiles the trusted profile as an additional system-control message when selected, and returns development audit metadata (`intentVersionId`, profile ID/version/hash, reason code).

The response remains `prototype: true` and `authoritative: false`. The current inference host is Windows/X64; `android-*` route/provider/worker identifiers remain legacy prototype names and do not transfer semantic authority.

## Protected boundary

This slice does not:

- create or persist canonical IntentVersion state;
- infer canonical intent from transcript text;
- change V36 Truth Core semantics or evidence admission;
- change Lattice Decision Engine eligibility/ranking/winner semantics;
- grant tools or financial transaction capability;
- add cross-conversation memory;
- activate a live/paid provider;
- change production database/data, secrets, billing, security ownership, or production deployment.

Canonical Intent Authority integration is intentionally deferred in this Work Item despite OD-004 design authority being resolved. Lifting the prototype boundary and connecting this mechanism to canonical runtime state requires a separate bounded Product Work Item.
