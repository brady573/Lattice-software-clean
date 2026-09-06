# Lattice 1.0 Alpha Roadmap

Status: **OWNER-DIRECTED CURRENT EXECUTION ROADMAP — SUBORDINATE TO THE CORE LATTICE PHILOSOPHY**

Date: **2026-09-06**

Reconciliation baseline before this roadmap update:

- canonical `main`: `c590d60322130367d02478488105c359f03287a8`
- tree: `97a24017c0661eb44f41fff5d6ae1a6f2348ba54`

This roadmap records the Owner-directed execution sequence for reaching a functional Lattice 1.0 Alpha. It does not amend or supersede `docs/design/The-Core-Lattice-Philosophy.md`, which remains the sole highest Product philosophy authority.

The roadmap exists to sequence implementation and validation. Repository code, tests, milestone history, architecture documents, provider qualifications, PRs, and this roadmap itself remain subordinate evidence or working Product state.

## Product direction

Lattice exists to make trustworthy expertise and decision capability accessible without making the user operate the machinery required to produce it.

For Alpha, progress is therefore measured primarily by complete user-facing Solandra capabilities, not by isolated subsystem completion.

The Alpha Product spine is:

```text
open Solandra
  -> express ordinary human intent
  -> resolve only materially necessary ambiguity
  -> use authorized capabilities
  -> investigate and govern knowledge where required
  -> produce understandable knowledge or decision support
  -> preserve authorization before consequential action
  -> present a useful outcome without exposing internal machinery as the user's job
```

A subsystem, provider integration, model adapter, workflow, validation layer, or architecture mechanism is not forward Product progress by itself. It enters the Alpha critical path when it removes an observed user barrier, preserves a necessary trust/control boundary, or is required to compose the end-to-end Product journey.

## Alpha definition

Lattice 1.0 Alpha is the first coherent Solandra application in which the major Product capabilities exist and work together.

Alpha does **not** require every mechanism to be generalized, optimized, production-hardened, provider-complete, or polished.

Alpha **does** require real capability rather than simulation.

At minimum, an Alpha candidate must establish that:

- a user can interact primarily through Solandra;
- ordinary user wording can become a workable governed objective without requiring the user to translate their problem into Lattice machinery;
- Lattice can reach useful trustworthy Knowledge when the available evidence supports it;
- Lattice can expose concise meaningful uncertainty or blockage when the evidence does not support an answer;
- at least one real model/service capability can be authorized and genuinely used through a valid Lattice-controlled route;
- conditional decision support can work end to end when the user's need is actually a decision;
- bounded Action Preparation can produce useful editable material without falsely claiming execution;
- conversation, intent, truth, decision, authorization, execution, verification, and presentation boundaries remain distinct where material;
- ordinary interruption, failure, cancellation, continuation, and recovery do not corrupt authority or user understanding;
- internal providers, models, workers, Run state, proof-state machinery, and workflow stages do not become work the ordinary user must operate.

## Current evidence baseline

Fresh canonical state before this roadmap change establishes substantial reusable infrastructure:

- Lattice Execution Runtime and durable Run coordination exist in accepted bounded scopes;
- V36 Truth Core remains the epistemic authority for external factual admission;
- Intent Authority and exact IntentVersion-to-Run binding exist;
- the generalized Decision Engine exists for qualified decision work;
- durable Conversation, continuity, reconnect, authenticated ownership/isolation, explicit preference continuity, and deletion-state enforcement exist in accepted bounded scopes;
- the Model Gateway, invocation provenance, capability policy, context projection, local model qualification, and bounded live-provider qualification machinery exist;
- Solandra Conversation + Composer is the current user-facing presentation direction;
- PR #15 established a real but narrow faithful plain-language Knowledge presentation capability for exactly one Knowledge finding within its qualified boundary.

These mechanisms are retained infrastructure. They are not a forward staircase that must be generalized or completed in subsystem order before Solandra becomes useful.

### Current black-box Product findings

Owner black-box use of canonical Solandra has exposed the current highest-value gaps:

1. Useful governed evidence can exist without Solandra synthesizing it into a direct answer to the user's question.
2. Ordinary human terminology and context are not yet reliably resolved into effective investigation concepts.
3. Current live Knowledge acquisition is too narrow for domains where authoritative primary or otherwise appropriate sources materially matter.
4. Internal epistemic/retrieval machinery can become visible user content rather than remaining behind meaningful Product boundaries.
5. Fail-closed truth behavior is functioning and must be preserved.
6. User-controlled model/service authorization through Solandra is not yet established as an end-to-end Product capability.

These observations govern Alpha sequencing more strongly than historical subsystem ordering because they reveal whether Lattice actually removes barriers at the Product surface.

---

# Alpha execution sequence

## A0 — Preserve the foundation; stop speculative machinery expansion

Status: **ACTIVE OPERATING RULE**

Preserve already-established infrastructure unless an observed Alpha blocker requires change:

- Intent Authority;
- Execution Runtime;
- V36 Truth Core;
- Decision Engine;
- Conversation and continuity;
- authenticated ownership/privacy boundaries;
- Model Gateway;
- capability policy and invocation provenance;
- existing persistence and recovery mechanisms;
- Solandra Conversation + Composer direction.

Do not redesign these merely because another architecture is possible.

Do not make historical M9/M10/M11/M12 ordering the automatic implementation sequence.

New infrastructure enters the Alpha critical path only when a concrete Alpha behavior requires it.

### A0 acceptance

PASS when substantial work is being selected by Product barrier or necessary boundary rather than milestone/subsystem completion alone.

---

## A1 — Trustworthy Knowledge spine

Status: **CURRENT PRODUCT FRONTIER / NEXT IMPLEMENTATION OBJECTIVE**

### Product outcome

An ordinary user asks Solandra a Knowledge question in ordinary language. Lattice resolves only materially necessary ambiguity, performs appropriate investigation, governs the resulting information through the existing truth boundary, and returns a concise answer responsive to the actual question with understandable provenance and uncertainty.

The user should not need to understand search vocabulary, V36 proof obligations, provider selection, research workers, internal findings, or evidence-state machinery in order to obtain useful understanding.

The required path is:

```text
ordinary user wording
  -> intent/context resolution
  -> minimal clarification when materially necessary
  -> investigation planning
  -> source acquisition appropriate to the domain
  -> relevance qualification
  -> V36 evidence/truth handling
  -> faithful answer synthesis/explanation
  -> Solandra answer
  -> inspectable provenance and uncertainty
```

### Required capability

A1 must address the underlying barrier rather than special-case supplied examples.

It may require bounded improvement to:

- semantic terminology/context resolution;
- ambiguity handling;
- investigation query planning;
- source selection/acquisition;
- source-quality boundaries by domain;
- multi-finding Knowledge synthesis;
- causal/explanatory answering;
- concise user-facing uncertainty and limitation presentation;
- Composer/conversation division so internal machinery is not exposed as Product content.

All such mechanisms remain subordinate to V36 and existing authority boundaries.

### Behavioral acceptance

A1 must include black-box scenarios covering at least:

1. **Known-evidence synthesis:** a question such as `Why does cast iron rust?` where governed evidence contains the answer and Solandra must lead with a concise causal explanation rather than source dumps.
2. **Terminology/context resolution:** ordinary user wording containing a legitimate domain abbreviation or shorthand, such as `TIC`, where Lattice either resolves the term only when sufficiently supported by context or asks the minimal material clarification.
3. **Negative relation case:** related material exists but does not license the requested conclusion; Lattice must reject or remain unresolved rather than synthesize a fluent unsupported answer.
4. **Source-quality case:** a domain where authoritative or primary sources materially matter; a general encyclopedia-only route must not masquerade as sufficient expertise.
5. **Conflicting evidence:** meaningful conflict remains visible and does not disappear during synthesis.
6. **Unresolved case:** Lattice cannot establish a supported answer and presents a concise meaningful limitation rather than internal proof-state terminology.
7. **Follow-up comprehension:** `why?`, `explain that more simply`, and `what are your sources?` work without changing authoritative meaning improperly.

### Preserve

- V36 remains truth authority;
- model output is not truth authority;
- canonical Knowledge identity/provenance/uncertainty is not silently rewritten;
- user intent is not silently expanded;
- semantic ambiguity is not guessed away when material;
- fail-closed behavior remains intact;
- no one-off dictionary rule is accepted as the general solution to terminology barriers;
- no generalized new orchestration stack is introduced without evidence that existing seams cannot support the capability.

### A1 exit condition

PASS when ordinary Knowledge consultation reliably converts supported governed evidence into useful understanding and honestly communicates unresolved boundaries without making the user operate Lattice's internal epistemic machinery.

---

## A2 — User-authorized model/service capability

Status: **PENDING A1 OR EARLIER ONLY IF A1 ESTABLISHES A HARD DEPENDENCY**

### Product outcome

A user can establish at least one real supported model/service capability through the Product, and Lattice can genuinely use that capability while Solandra remains the primary interaction surface.

Provider mechanics are machinery. The provider does not become Product authority.

### Alpha scope

Alpha requires **one genuine supported route**, not a generalized provider marketplace or routing framework.

A second provider may be used later to prove provider neutrality where that becomes materially necessary, but multiple-provider breadth is not required merely to call the first Alpha Product spine real.

### Required behavior

- the user can select/authorize the supported capability through an understandable Product flow;
- authorization establishes a genuinely usable route;
- provider credentials/tokens do not become semantic Product authority;
- the authorized capability is reachable from canonical Solandra behavior;
- capability availability and limitations are represented honestly;
- revocation/disconnect/change is respected;
- provider failure fails visibly rather than silently substituting an unqualified route;
- Lattice retains provenance needed to know which capability actually performed the work where material;
- the user is not required to manually operate provider prompts, routing, workers, or intermediate model state.

### A2 exit condition

PASS when the user can authorize a real model/service capability and Solandra/Lattice can genuinely manage its bounded use on the user's behalf.

---

## A3 — End-to-end Decision capability

Status: **PENDING**

### Product outcome

A realistic ordinary conversation can move into qualified decision support only when the user's actual need requires a decision.

Reuse the existing Decision Engine. Do not generalize it speculatively.

### Required path

```text
conversation
  -> canonical intent
  -> materially necessary clarification
  -> evidence gathering / Knowledge
  -> qualified DecisionPlan only when needed
  -> Decision Engine
  -> understandable trade-offs / recommendation within licensed boundary
  -> Solandra presentation
```

### Required behavior

- identify the actual decision objective without silently manufacturing criteria;
- ask only material clarification;
- gather evidence needed for the decision;
- preserve USER priorities and hard requirements;
- expose meaningful trade-offs;
- avoid forcing a winner when the evidence/requirements do not support one;
- preserve explicit bounded delegation where used;
- keep truth distinct from decision and decision distinct from authorization.

### A3 exit condition

PASS when at least one realistic decision journey works completely through Solandra without making the user operate Decision Engine machinery.

---

## A4 — End-to-end Action Preparation

Status: **PENDING**

### Product outcome

Solandra can transform established intent/knowledge into a useful bounded editable resource when requested, while preserving the distinction between preparation and execution.

Alpha examples may include:

- a checklist;
- a message;
- another already-licensed bounded editable resource.

### Required behavior

- Action Preparation is explicitly requested or otherwise valid under the existing boundary;
- prepared material remains inspectable/editable;
- nothing is represented as sent, executed, booked, submitted, or otherwise performed unless a separate authorized execution capability actually exists;
- decision, authorization, execution, and verification remain distinct.

### A4 exit condition

PASS when Solandra can prepare genuinely useful material from the governed Product state without falsely claiming consequential execution.

---

## A5 — Continuity, interruption, failure, and recovery as one Product

Status: **PENDING**

### Product outcome

Exercise the already-built continuity/runtime/privacy machinery through the complete Alpha experience rather than treating it as isolated infrastructure.

### Black-box acceptance

At minimum validate:

- reload/reconnect during and after work;
- conversation continuation;
- preserved accepted intent;
- explicit intent correction;
- subject ownership/isolation;
- capability/provider interruption;
- research/acquisition failure;
- partial uncertainty;
- cancellation;
- licensed retry/recovery;
- unavailable or revoked capability;
- blocked or unresolved outcomes.

The user should receive meaningful Product state. Internal workers, epochs, retries, provider machinery, and proof-state internals should remain hidden unless a material trust/control boundary requires exposure.

### A5 exit condition

PASS when the Alpha Product spine survives ordinary interruption and failure without corrupting state, authority, provenance, or user understanding.

---

## A6 — Lattice 1.0 Alpha release candidate

Status: **PENDING**

Freeze one exact candidate and validate the Product as a whole.

Alpha acceptance prioritizes user-observable capability over subsystem existence.

### Required release evidence

One exact candidate must establish:

- A1 Trustworthy Knowledge spine: PASS;
- A2 user-authorized model/service capability: PASS;
- A3 end-to-end Decision capability: PASS;
- A4 end-to-end Action Preparation: PASS;
- A5 continuity/failure/recovery: PASS;
- necessary privacy/security/authorization boundaries remain intact;
- provenance and uncertainty remain inspectable where material;
- model/provider output has not become truth or decision authority;
- no Product-critical capability is represented as existing when it does not;
- no Product-critical path requires the ordinary user to operate models, providers, workers, workflow stages, or proof-state machinery;
- exact candidate validation is reproducible;
- remaining Alpha limitations are explicit and qualified rather than simulated away.

### A6 exit condition

PASS when Lattice can be used as one coherent Solandra application demonstrating its major Product capabilities end to end.

That candidate is **Lattice 1.0 Alpha**.

---

# Post-Alpha refinement

Once the Alpha Product spine exists, use real black-box behavior to determine which machinery deserves further refinement.

Potential post-Alpha work may include, only when justified by observed need:

- broader provider/service support;
- provider neutrality validation across a second genuinely supported route;
- routing/fallback policy;
- source breadth and domain-specific source quality;
- performance/latency improvements;
- richer model role qualification;
- production operations and deployment hardening;
- backup/rollback/SLO/security operational acceptance;
- retention/purge policy completion;
- additional recovery automation;
- accessibility/usability polish;
- expanded benchmarks driven by observed Product barriers;
- selective architecture simplification where Alpha exposes unnecessary maintenance burden.

Post-Alpha refinement must not retroactively excuse an incomplete Alpha capability.

---

# Historical milestone reconciliation

The previous M0-M12 roadmap remains historical implementation and acceptance provenance, not the current forward execution staircase.

## Retained accepted foundation

The following prior milestone scopes remain useful accepted evidence within their exact qualified boundaries:

- M0 Product baseline;
- M1 external V7 simulation/prototype evidence;
- M2 historical Solandra offline-prototype design provenance;
- M3 durable Execution Runtime composition;
- M4 durable V36 research continuation handshake;
- M5 Intent Authority and exact Run binding;
- M6 generalized Decision Engine;
- M7 Conversation/progress/reconnect;
- M8 authenticated ownership/privacy/explicit preference continuity.

Do not rebuild these under new names without evidence of an Alpha blocker.

## Partially useful later-stage machinery

Historical M9/M10 work remains reusable evidence and implementation where it serves an Alpha vertical capability:

- invocation provenance;
- capability execution policy;
- bounded external context projection;
- local model qualification;
- bounded live-provider qualification;
- existing live research/model operation seams;
- Solandra Conversation + Composer presentation;
- PR #15 faithful single-finding simplification.

Their historical milestone ordering no longer determines what is implemented next.

M11/M12 production/stabilization concepts remain future evidence sources, but Alpha does not require company-scale or hypothetical future infrastructure. Production and release hardening will be scoped from the real Alpha Product and the Owner's actual deployment needs.

---

# Current open decisions and blockers

Existing Owner decisions and open decisions retain only the authority they already had under the Core Philosophy.

Do not treat unresolved historical roadmap decisions as automatic blockers to an Alpha vertical unless the relevant Alpha behavior actually depends on them.

In particular:

- provider routing/fallback policy is not required merely to prove one real Alpha-authorized provider route;
- generalized model-assisted explanation policy must be resolved only to the extent required by the exact A1/A2 implementation boundary;
- production topology/SLO/backup/operations decisions are not prerequisites for proving local/development Alpha Product capability unless the Owner explicitly makes hosted production Alpha the target.

When a vertical encounters a genuine Product decision rather than an engineering choice, stop and return that bounded decision to the Owner.

---

# Roadmap operating rules

For every substantial proposed work item, answer:

1. **Which observable Alpha barrier does this remove?**
2. **Which necessary trust/control boundary would fail without it?**

At least one answer must be concrete.

Also apply:

- prefer a complete vertical capability over disconnected infrastructure;
- prefer one real provider capability over several nominal adapters;
- prefer direct black-box Product evidence over subsystem-local confidence;
- preserve existing sound mechanisms rather than rebuilding for architectural taste;
- do not special-case only the supplied discriminator wording;
- do not weaken V36 or other authority boundaries to obtain fluent output;
- do not treat a model as truth authority, decision authority, or authorization authority;
- do not expose internal machinery merely because it exists;
- do not build enterprise/team coordination machinery for this single-owner hobby project;
- complexity must earn its one-person maintenance cost;
- PASS, FAIL, BLOCKED, PARTIAL, UNKNOWN, and NOT ESTABLISHED remain distinct evidence outcomes.

## Validation rule

A subsystem test proves only the behavior it actually exercises.

Green CI does not establish Product acceptance.

A provider invocation does not establish Solandra integration.

A type or adapter does not establish capability.

A presentation does not establish authority.

A historical acceptance does not automatically transfer to a changed candidate.

For Alpha promotion, the strongest evidence is reproducible end-to-end behavior on the exact candidate through the ordinary Solandra path.

---

# Current Product frontier

**A1 — Trustworthy Knowledge spine**

This is the highest-value current objective because canonical black-box use has already established that Lattice possesses substantial truth/runtime machinery while ordinary users can still be forced to perform terminology translation, evidence synthesis, and proof-state interpretation themselves.

The next implementation work should therefore make the existing governed Knowledge path complete enough to deliver useful understanding without sacrificing provenance, uncertainty, semantic authority, fail-closed behavior, or human control.

Do not automatically resume M9-5 or another historical milestone simply because it was previously next in sequence.

---

# Supreme Product test

Before accepting any roadmap item, implementation, retained mechanism, or Alpha promotion, ask:

> **Does this use knowledge to remove a meaningful barrier for the user, preserve the boundaries required for trust and human control, keep authority where it belongs, and reduce rather than transfer unnecessary complexity?**

For this single-owner project also ask:

> **Would this still be worth its complexity if one person had to understand, operate, debug, and maintain it?**

And for Alpha:

> **Does this bring Lattice closer to a person opening Solandra, expressing ordinary intent, using genuinely authorized capability, and receiving a trustworthy useful outcome managed by Lattice rather than by the user operating its machinery?**

If not, the work must protect a necessary boundary or enable a necessary prerequisite. Otherwise it is outside the Alpha critical path.
