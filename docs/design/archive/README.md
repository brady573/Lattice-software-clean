# Lattice Design Document Ownership Map

Status: **NON-AUTHORITATIVE DESIGN INDEX / MAINTENANCE MAP**

Reconciled against design base: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

Reconciliation date: **2026-09-08**.

`The-Core-Lattice-Philosophy.md` remains unchanged and is the highest Product-design authority. This file is only an index and cannot create or change Product requirements.

## 1. Current precedence

For current Product design:

1. `The-Core-Lattice-Philosophy.md`
2. current Owner decisions, including `Lattice-Owner-Decision-OD-011-Solandra-Cognition-Lattice-Trust-Reconciliation.md`
3. current reconciled permanent architecture documents
4. current Living Software Design direction
5. current Solandra interaction/design contracts for presentation/interaction
6. fresh canonical source for implementation facts

Older Owner decisions, amendments, milestone designs, and prototype approvals remain historical provenance. Where their cognition/trust allocation conflicts with OD-011, the conflicting clause is superseded for current direction even though the historical text remains inspectable.

## 2. Current architecture maintenance homes

| Responsibility | Primary maintenance home |
| --- | --- |
| Highest Product philosophy / exclusion filter | `The-Core-Lattice-Philosophy.md` |
| Current cognition/trust Owner reconciliation | `Lattice-Owner-Decision-OD-011-Solandra-Cognition-Lattice-Trust-Reconciliation.md` |
| Foundational Product-design elaboration | `Lattice-Foundational-Design-Principle.md` |
| Cross-cutting trust/anti-collapse invariants | `Lattice-Architecture-Integrity.md` |
| Canonical system/boundary vocabulary | `Lattice-System-Registry-and-Naming.md` |
| Forward 1.0 Product direction and sequencing | `Lattice-Living-Software-Design-to-1.0.md` |
| Current implementation mapping + target composition | `Lattice-System-Architecture.md` |
| Solandra understanding, Intent Integrity, Recommendation, optional formal decision semantics | `Lattice-Intent-and-Decision-Architecture.md` |
| Durable governed state, Knowledge graph, ConversationReference, action/verification persistence | `Lattice-State-and-Persistence-Architecture.md` |
| Capability-first execution, Runtime safety, action dispatch mechanics | `Lattice-Execution-and-Capability-Architecture.md` |
| Resource identity and Recommendation -> ActionProposal -> Authorization -> receipt/verification chain | `Lattice-Resource-and-Action-Architecture.md` |
| Retry/recovery/reconnect/ambiguity/observability | `Lattice-Reliability-and-Recovery-Architecture.md` |
| Live provider/model qualification and route provenance | `M9-Live-Provider-Promotion-Architecture.md` |
| Solandra primary continuous interaction | `solandra/PRIMARY-INTERACTION-CONTRACT.md` |
| Solandra conversational cognition/continuity presentation | `solandra/CONVERSATION-FLOW.md` |
| Concrete primary UI composition | `solandra/UI-DESIGN.md` |
| Domain-independent UI rules | `solandra/UNIVERSAL-UI-DESIGN.md` |
| Visual/component vocabulary | `solandra/DESIGN.md` |
| Solandra black-box acceptance intent | `solandra/ACCEPTANCE.md` |

## 3. Current logical allocation

Current direction is intentionally simple:

```text
Solandra = cognition
Lattice = trust
models / sources / algorithms / tools = capabilities
```

Solandra performs ordinary semantic understanding, planning, investigation strategy, reasoning, advisory Recommendation, capability coordination, and natural explanation.

Lattice establishes/guards Intent Integrity, governed Knowledge/provenance/uncertainty, bounded execution safety, narrow consequential Authorization, durable recovery, and Verification.

The formal Lattice Decision Engine remains an optional qualified capability for problems that materially benefit from its typed formal guarantees. It is not the universal ordinary-Recommendation path.

## 4. Historical Owner decisions and amendments

Preserve these records exactly as history unless a separate Owner instruction requires another change:

- `Lattice-Owner-Decisions-OD-001-to-OD-004.md`
- `Lattice-Owner-Decision-OD-007-M8-Continuity.md`
- `Lattice-Living-Software-Design-to-1.0-v0.6-amendment.md`
- `Lattice-Living-Software-Design-to-1.0-v0.7-amendment.md`
- `Lattice-Living-Software-Design-to-1.0-v0.8-amendment.md`
- `M8-Auth-Privacy-Continuity-Architecture.md`
- `solandra/APPROVAL.md`
- `solandra/UX-CONTRACT.md`

OD-011 explicitly records which material older clauses are retained, narrowed, or superseded. Historical files must not be used to re-impose superseded presentation-only Solandra or universal Decision Engine allocation on current Product direction.

## 5. Protected inherited mechanisms

Current architecture deliberately retains useful predecessor work, including:

- V36 evidence/provenance/uncertainty discipline;
- immutable USER provenance and correction lineage;
- subject ownership/privacy/deletion boundaries;
- durable Run/task/CAS/retry/idempotency/restart safety;
- provider/model non-authority and minimum-necessary context;
- capability-before-provider;
- preparation distinct from consequential Authorization/execution;
- ambiguous consequential completion protection;
- continuous Conversation + free-form ConversationInput + adaptive Composer;
- accessibility and responsive UI constraints;
- modular-monolith preference for this one-owner project.

## 6. Anti-drift use of this index

Before editing design:

1. identify the true maintenance home;
2. apply Core and current Owner precedence;
3. preserve history instead of rewriting it to appear always consistent;
4. keep cognition, trust, capability, persistence, presentation, execution, authorization, and verification distinctions explicit;
5. do not promote a milestone/provider/UI document into universal architecture;
6. do not add a new top-level system merely to rename an existing module;
7. use fresh source for current implementation claims.

If this index conflicts with an authoritative source, the authoritative source wins and this index must be repaired.
