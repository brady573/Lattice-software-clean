# Lattice System Registry and Naming

Status: **OWNER-APPROVED CANONICAL NAMING / BOUNDARY REGISTRY — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This registry is subordinate to the Core and to current Owner decision OD-011.

## 1. Purpose

This registry keeps names aligned with real Product responsibility. Names do not create authority; they make authority and capability boundaries easier to see.

## 2. Canonical logical planes

### Solandra — cognitive plane

Canonical name: **Solandra** or **Solandra Cognitive Runtime** when the distinction from UI rendering matters.

Owns ordinary cognitive behavior:

- conversation understanding and reference resolution;
- interpretation/hypothesis formation;
- clarification strategy;
- investigation planning;
- reasoning over governed Knowledge;
- advisory Recommendation;
- capability coordination;
- natural explanation; and
- Conversation + Composer interaction.

Does not own factual truth, USER authority, consequential authorization, execution authority, or verification authority.

### Lattice — trust plane

**Lattice** is the trust system that constrains and records what Solandra may responsibly rely upon or cause.

Its stable trust responsibilities are:

- **Intent Integrity** — established USER meaning, provenance, correction lineage, and material clarification/confirmation;
- **Knowledge Trust** — Source/Evidence/Claim/Knowledge provenance, support/conflict/uncertainty, currency, and admission;
- **Execution Safety** — bounded capabilities, idempotency, retry/recovery, stale-result rejection, budgets, privacy/egress, and operational provenance;
- **Action Trust** — ActionProposal binding, Authorization, ExecutionReceipt, and Verification.

These responsibilities may be implemented in modules rather than separate services.

### Capability plane

**Capabilities** are replaceable mechanisms Solandra can request through Lattice-owned policy/execution boundaries.

Examples:

- model reasoning;
- web/source acquisition;
- document reading;
- database query;
- calculation;
- code execution;
- formal decision algorithms;
- file/application manipulation;
- external communication/action.

Capability identity does not grant semantic authority.

## 3. Existing canonical subsystem/component names

### Lattice Intent Integrity

Preferred current Product name for the trust boundary historically called **Lattice Intent Authority**.

Existing `IntentVersion`, provenance, clarification, correction, and exact-binding mechanisms remain valid foundations. The name change narrows responsibility: Solandra performs ordinary semantic understanding; Lattice establishes what meaning is justified as canonical USER intent.

When discussing historical decisions/source names, `Lattice Intent Authority` remains correct historical terminology.

### Lattice Knowledge Trust

Preferred Product-level name for the governed information-to-Knowledge boundary.

**V36 Truth Core** remains the canonical name of the protected epistemic mechanism/contracts already present in the repository. V36 may implement substantial portions of Knowledge Trust; it is not discarded or weakened by OD-011.

### Lattice Execution Runtime

Canonical implementation/trust mechanism for durable operational lifecycle, bounded execution, workers/tasks, retry, cancellation, idempotency, stale-result rejection, budgets, and recovery.

Runtime is not the Product's cognitive model. `Run`, worker, task, attempt, lease, queue, dispatch, checkpoint, and outbox are implementation/operational terms and should not be promoted to primary user-facing concepts without a demonstrated trust need.

### Capability Broker

Canonical **logical interface**, not automatically a separate service or top-level authority.

It describes the Product-facing capability catalog/request boundary used by Solandra. Execution Runtime, Model Gateway, research adapters, local functions, or other executors may implement capabilities behind it.

### Lattice Model Gateway

Canonical provider-neutral model adapter/mechanism. It supplies model capabilities and route normalization. It does not own cognition, USER intent, Knowledge, Recommendation, Authorization, or Verification.

### Lattice Decision Engine

Canonical name for the existing **optional qualified formal decision capability**.

It may own formal semantics for a specific invocation: typed hard-constraint evaluation, qualified criterion comparison, optimization/frontier/tie logic, and structured formal result.

It is **not** the universal source of ordinary Recommendation state.

### Lattice Action Trust boundary

Canonical umbrella name for the action safety chain:

```text
ActionProposal -> Authorization -> ExecutionReceipt -> Verification
```

Execution is performed through qualified capability/executor mechanisms. The trust boundary owns the distinctions and exact bindings, not a particular executor technology.

## 4. Canonical governed object names

Use these terms consistently for target durable Product state:

- `Intent`
- `Source`
- `Evidence`
- `Claim`
- `Knowledge`
- `Recommendation`
- `ActionProposal`
- `Authorization`
- `ExecutionReceipt`
- `Verification`
- `ConversationReference`

Historical implementation types such as `IntentVersion`, `TruthSnapshot`, `StructuredDecision`, `Resource`, or `Run` may continue where they carry real implementation semantics. They should map to, rather than redefine, the current Product distinctions.

## 5. Naming grammar

Prefer names that describe the role a concept actually owns:

- **Cognitive Runtime** — interprets/reasons/plans but does not become trust authority.
- **Integrity / Trust** — establishes what may be treated as canonical, factual, authorized, or verified.
- **Capability** — bounded useful operation; replaceable provider/tool implementation.
- **Runtime** — durable operational coordination/recovery.
- **Gateway / Adapter** — translation/routing mechanism, never authority merely by name.
- **Engine** — formal algorithmic capability with explicitly qualified semantics.
- **Reference** — durable link to an already-governed object; not a copied authority.

Avoid multiplying peer “systems” when a module/interface inside the modular monolith is sufficient.

## 6. Canonical Product composition

```text
USER
  <-> Solandra Cognitive Runtime
          |
          +--> Lattice Intent Integrity
          +--> Lattice Knowledge Trust
          +--> Capability Broker
          |       +--> user-authorized model
          |       +--> sources/tools/algorithms
          |       +--> optional Lattice Decision Engine
          |
          +--> Recommendation
          +--> ActionProposal
                  |
                  v
          Lattice Action Trust
          Authorization -> Execution -> ExecutionReceipt -> Verification
```

ConversationReference binds later conversational references to the exact governed objects used/produced by prior turns.

## 7. Preferred wording

Prefer:

- “Solandra reasoned over governed Knowledge and produced a Recommendation.”
- “Lattice admitted the supporting evidence into Knowledge.”
- “The formal Decision Engine was used as a qualified capability for this comparison.”
- “Lattice Intent Integrity accepted the USER-supported meaning.”
- “The executor returned an ExecutionReceipt; Lattice has not yet verified the resulting state.”

Avoid:

- “Solandra is presentation only.”
- “Every recommendation comes from the Decision Engine.”
- “The model established the user's intent.”
- “The provider response is truth.”
- “The Run decided.”
- “Execution success proves completion.”

## 8. Historical terminology

Older Owner decisions and design records retain their original names as provenance. Current documents should point to OD-011 when an older historical allocation conflicts with current direction rather than rewriting the historical record to pretend the earlier architecture never existed.
