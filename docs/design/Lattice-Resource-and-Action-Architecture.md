# Lattice Resource and Action Architecture

Status: **RECONCILED DRAFT — Owner-directed cross-system resource/action architecture**

Drafted: **August 31, 2026**

Reconciled: **August 31, 2026**

Repository reconciliation baseline: `main @ c7effc72b8efd942ff566d1d80b3d0e15f3e6301`, tree `291ae4a6717edb8e1447bfebe153da7cd42ded47`.

## 1. Purpose

Lattice needs one permanent application-level architecture for the material Solandra gives a person so they can actually understand, decide, and take the next step.

The UI already exposes the concept through Resources such as links, contacts, images, video, audio, documents, maps, prepared messages, checklists, comparisons, forms, and generated artifacts. The Product architecture must make those objects safe, attributable, current, subject-bound, and extensible without turning presentation state into authority or prepared assistance into silent execution.

The stable composition is:

```text
accepted Product state
      |
      | determines what is useful and licensed to prepare
      v
Resource need / specification
      |
      +--> deterministic projection
      |
      +--> bounded retrieval / generation capability
      |
      v
exact Resource version
      |
      | provenance + subject/basis binding
      | content-validity + relevance + availability state
      v
ResourceDescriptor
      |
      | lazy hydration when needed
      v
HydratedResource
      |
      +--> inspect / copy / download / play / open / edit / use as input
      |
      +--> prepare an ActionProposal
                 |
                 | exact proposal version/digest
                 | separate authorization where required
                 v
          Execution Runtime policy gate
                 |
                 v
          bounded capability operation
                 |
                 v
          result + operational provenance
```

The central rule is:

> **A Resource helps a person act; it does not silently become authority to act for them.**

Resources bridge the gap between “Solandra knows what would help” and “Solandra gives the person what they need to do it.”

## 2. Authority and relationship to other architecture

This document owns the stable Resource and prepared-action model. It does not replace the semantic or operational authorities that produce, validate, select, execute, or present Resource content.

It must remain consistent with:

- `Lattice-Foundational-Design-Principle.md` — first Product-design filter;
- `Lattice-Architecture-Integrity.md` — protected semantic ownership boundaries;
- `Lattice-System-Registry-and-Naming.md` — canonical subsystem vocabulary;
- `Lattice-System-Architecture.md` — current structural composition;
- `Lattice-State-and-Persistence-Architecture.md` — ownership, derived state, persistence, reconstruction, deletion, and staleness;
- `Lattice-Intent-and-Decision-Architecture.md` — USER meaning, evidence, recommendation, selected outcome, confirmation, and delegation semantics;
- `Lattice-Execution-and-Capability-Architecture.md` — capability licensing, side effects, consequential-action boundaries, retries, cancellation, and operational provenance;
- protected V36 specifications — factual evidence and external truth admission;
- M8 continuity/privacy decisions — authenticated subject ownership and deletion boundaries; and
- `docs/design/solandra/PRIMARY-INTERACTION-CONTRACT.md` — controlling primary presentation contract.

The current Solandra interaction contract controls when and how Resources are useful in the Composer. This architecture controls what a Resource **is**, where it comes from, how it remains valid and relevant, who may access it, and what its application-issued use capabilities may or may not authorize.

## 3. Foundational Product objective

A person should not have to leave Solandra to assemble obvious supporting material that Lattice can safely provide.

If Solandra recommends contacting a venue, Lattice should be able to provide qualified contact details and, where useful, a prepared message.

If a next step requires a form, map, checklist, comparison, source document, generated document, or other artifact, Lattice should be able to provide that material directly when the necessary Product authority and capability exist.

The architecture therefore optimizes for:

1. **action completeness** — provide the material needed to make a next step realistically executable;
2. **minimum friction** — avoid making the person repeat searches or reconstruct information Lattice already possesses;
3. **authority fidelity** — Resource content cannot strengthen intent, truth, recommendation, or authorization merely by being polished or actionable;
4. **validity and relevance** — factual/source currency and current usefulness remain independently testable;
5. **subject isolation** — access to Resources derived from a user's Product graph remains bound to the authenticated subject and owning Conversation graph;
6. **preparation before consequential execution** — Lattice may prepare useful material without treating preparation as permission to perform the later action;
7. **one extensible model** — media types and action helpers share one application-level envelope instead of creating one subsystem per UI widget; and
8. **progressive hydration** — heavy or external payloads are loaded only when needed and only against a current, permitted basis.

Preparation itself may still involve external processing, privacy exposure, cost, or bounded capability execution. “Prepare” therefore means **does not perform the target consequential action**; it does not mean “no execution or external effect occurred while producing the Resource.”

## 4. Resource is an application concept, not a UI component

A Resource is a Product-described item that materially helps a person:

- resolve a knowledge gap;
- understand authoritative Product state;
- compare viable options;
- perform a recommended next step;
- inspect supporting evidence or provenance; or
- prepare a later action.

A Resource may be rendered in the Composer, exported, copied, downloaded, played, opened externally, or supplied to a later capability. None of those presentation/use modes changes the Resource's semantic ownership.

The same Resource version may have multiple presentation adapters. The UI component is replaceable; the Resource identity, version, basis, provenance, validity contract, access boundary, and allowed uses are application state.

## 5. Resource kinds

The stable architecture supports an extensible kind model. At minimum it must be able to represent:

```text
TEXT
LINK
CONTACT
IMAGE
VIDEO
AUDIO
DOCUMENT
MAP_OR_LOCATION
PREPARED_MESSAGE
CHECKLIST
FORM
COMPARISON
GENERATED_ARTIFACT
OTHER_QUALIFIED_RESOURCE
```

These are content/interaction kinds, not authority classes.

### 5.1 Text

A bounded text Resource may contain instructions, source material, a compact explanation, structured information, or prepared text.

### 5.2 Link

A Link Resource contains a qualified destination plus enough provenance and validity information to determine why the link is appropriate and whether it is still usable for its stated purpose.

A URL is not self-authenticating truth. Where the destination is used as factual evidence, V36 controls evidence admission.

### 5.3 Contact

A Contact Resource may include a person, organization, phone number, email address, address, hours, or other contact channel.

Contact fields that assert external-world facts require appropriate factual provenance. The mere existence of a Contact Resource does not authorize sending, calling, or sharing data with that contact.

### 5.4 Image, video, and audio

Media Resources preserve source/provenance, content identity, and applicable validity or usage constraints.

Media generation or transformation may use bounded Product capabilities, but generated media does not acquire truth merely because a model or provider produced it.

### 5.5 Document and generated artifact

Documents may be retrieved source documents or Product-generated artifacts such as reports, plans, summaries, export packages, prepared forms, or decision material.

Generated artifacts must remain attributable to the exact Product state and generation capability/result that produced them.

### 5.6 Map or location

A map/location Resource represents one or more locations plus the factual basis required for those locations. Displaying a map is presentation; geocoding, routing, live business state, traffic, hours, and other external claims remain subject to their owning evidence/capability contracts.

### 5.7 Prepared message

A Prepared Message Resource is editable material the person may review, copy, export, or later choose to send.

Preparation is not sending.

A prepared message may contain a target recipient and subject/body proposal, but that proposal does not independently establish recipient identity, consent, or permission to transmit.

### 5.8 Checklist

A Checklist Resource organizes user-facing steps. Checklist completion state may remain temporary interaction state unless a separately qualified Product feature makes completion durable application state.

Checking a box does not silently create USER intent, external execution, or verified external completion.

### 5.9 Form

A Form Resource may help collect or prepare structured information.

The form may be:

- informational/read-only;
- locally editable preparation;
- structured input into another Lattice capability; or
- an external form requiring explicit handoff or execution.

Submitting a form to an external system is execution, not ordinary Resource viewing.

### 5.10 Comparison

A Comparison Resource faithfully projects Decision Engine, V36, and Intent Authority state as applicable. It must not construct a winner or recommendation that is absent from authoritative Decision Engine state.

## 6. Stable Resource envelope

The long-term Resource contract should be equivalent to:

```ts
type ResourceKind =
  | "text"
  | "link"
  | "contact"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "map_or_location"
  | "prepared_message"
  | "checklist"
  | "form"
  | "comparison"
  | "generated_artifact"
  | "other";

type ResourcePurpose =
  | "resolve_knowledge_gap"
  | "support_understanding"
  | "support_decision"
  | "enable_next_action"
  | "inspect_evidence";

interface ResourceBasis {
  conversationId: string;
  ownerSubjectId: string;
  intentVersionId?: string;
  decisionPlanId?: string;
  runId?: string;
  runVersion?: number;
  structuredDecisionRef?: string;
  truthRefs?: string[];
  capabilityResultRefs?: string[];
}

interface ResourceDescriptor {
  resourceId: string;
  resourceVersion: string;
  kind: ResourceKind;
  title: string;
  purpose: ResourcePurpose;
  basis: ResourceBasis;
  provenance: ProvenanceRef[];
  validity: ResourceValidity;
  capabilities: ResourceUseCapability[];
  hydration: ResourceHydrationContract;
}
```

Exact field names may evolve. The material distinctions may not be collapsed.

## 7. Resource identity and versioning

A Resource needs a stable logical identity distinct from presentation placement and execution identity.

```text
resourceId             = logical Resource identity
resourceVersion        = exact material Resource state
presentationRevision   = exact Solandra presentation projection
operationId            = exact execution operation identity
ActionProposal version = exact prepared execution proposal state
```

These identities serve different purposes.

A newer presentation may show the same Resource version. A Resource may be regenerated into a new Resource version without changing Conversation identity. An external execution using a Resource requires its own operation identity.

`presentationRevision` must not become the permanent Resource identity.

### 7.1 What changes Resource version

A new Resource version is required when a material execution/use basis changes, including a change to:

- payload or material structured fields;
- authoritative basis used to produce the Resource;
- source identity or admitted factual basis;
- provenance needed to interpret the payload;
- target/recipient/location used by a prepared action;
- material use-capability contract; or
- any field whose change would make a prior ActionProposal or prior authorization unsafe to reuse.

A purely presentational change does not require a new Resource version.

A runtime observation such as “source is temporarily unreachable” may change current availability without rewriting an immutable historical Resource version.

### 7.2 Version immutability

Once a Resource version is used as a provenance or ActionProposal basis, that exact version must be immutable. Editing a prepared message or form therefore creates a successor Resource version or an explicitly versioned draft state; it must not mutate the already-bound version in place.

## 8. Provenance

Every material Resource must be attributable to the Product state and/or capability that produced its content.

Provenance may include:

```text
IntentVersion
DecisionPlan
Run / Run version
V36 evidence or truth checkpoint
StructuredDecision
qualified Product capability
operational result
external source identity
resource-generation operation
```

The provenance contract must answer:

- why this Resource exists;
- which Product state made it relevant;
- which authority supports any material semantic claim;
- which capability retrieved or generated it;
- whether content is direct source material, derived material, or generated material; and
- what dependencies can make it invalid or no longer relevant.

Provenance itself does not transfer authority. A generated artifact containing factual claims still relies on V36-admitted evidence for those claims.

## 9. Validity is multi-axis

The first draft used one Resource “freshness” concept for several different questions. Dedicated reconciliation rejects that collapse.

A Resource may be factually/source-current but no longer relevant to the person's current need. Conversely, a Resource may remain historically relevant to the decision basis while one live fact inside it has expired. Availability can also change without changing either relevance or factual validity.

Therefore Resource validity has at least three independent axes.

### 9.1 Basis relevance / compatibility

This answers:

> **Does this exact Resource version still belong to the active Product basis for the use being attempted?**

Conceptual states:

```text
CURRENT_BASIS
SUPERSEDED_BASIS
HISTORICAL_ONLY
```

Examples of basis invalidation include:

- accepted USER intent materially changed;
- the DecisionPlan or StructuredDecision used by the Resource is no longer the current basis for the action;
- the Resource is bound to a prior Run or decision state and cannot safely be reused for the current action.

Basis invalidation must be dependency-driven. A new Run does **not** automatically invalidate every Resource derived from an immutable fact or source that remains independently valid.

### 9.2 Content/source validity

This answers:

> **Are the external claims, source references, destinations, contacts, or generated statements still valid under their owning contracts?**

Conceptual states:

```text
CURRENT_SOURCE
EXPIRED_SOURCE
INVALIDATED_SOURCE
UNKNOWN_SOURCE_VALIDITY
NOT_SOURCE_DEPENDENT
```

Examples include:

- a phone number or business hour exceeded its qualified validity window;
- a destination disappeared or changed;
- V36 superseded or contradicted the evidence basis;
- a generated artifact depends on factual inputs that are no longer admitted as current.

Historical source material may remain retrievable as historical material even when it is no longer valid for a current action.

### 9.3 Availability / hydration readiness

This answers:

> **Can Lattice currently supply or hydrate this exact Resource version?**

Conceptual states:

```text
PREPARING
AVAILABLE
TEMPORARILY_UNAVAILABLE
PERMANENTLY_UNAVAILABLE
RETIRED
```

Availability may change because a provider is unavailable, a payload was purged, a source is temporarily inaccessible, a capability is disabled, or a generation operation failed.

Availability failure is not evidence that the Resource's underlying factual claim is false.

### 9.4 No global TTL

Not every Resource needs a short TTL. A generated checklist based only on immutable IntentVersion state may remain content-valid until the relevant intent changes. A business phone number or operating hour may require source recency. A downloaded source document may remain historically valid while becoming unsuitable for a present action.

Resource validity therefore cannot be represented by one global age number or one generic `stale` boolean.

### 9.5 Validity contract

A Resource version should retain enough dependency metadata to re-evaluate material validity without trusting cached presentation state. A future implementation may encode:

```text
basis dependency identities
source/evidence dependency identities
observedAt / generatedAt where relevant
validThrough or refresh policy where qualified
producer/result identity
current availability state
```

The exact fields are implementation choices; the independent validity questions are architectural requirements.

## 10. Subject ownership and access root

Resources are accessed through the authenticated Product graph.

The normal access chain is:

```text
AuthenticatedSubject
      |
      v
owned Conversation
      |
      v
ResourceDescriptor / Resource basis
      |
      v
hydrated Resource
```

Every Resource API must first establish the owned Conversation or another separately qualified subject-owned root before disclosing whether a child Resource exists.

`ownerSubjectId` means access/ownership binding inside the Lattice Product graph. It does not mean the user owns the external person, business, document, map location, or other subject represented by the Resource.

Resource IDs are not bearer capabilities and must not bypass ownership checks.

Cross-subject guessing must fail closed without useful object-existence leakage.

Generated artifacts, prepared messages, contacts selected for a user, and other Resource payloads may contain personal or contextual information; they inherit applicable deletion/privacy boundaries.

## 11. Resource production

Resources can arise through three broad paths.

### 11.1 Projection

Some Resources are deterministic projections over already-authoritative Product state.

Examples:

- a decision comparison generated from StructuredDecision;
- a checklist derived from an accepted plan;
- a criteria summary derived from IntentVersion/DecisionPlan;
- a prepared explanation derived from admitted V36 evidence.

Projection does not require a new semantic authority.

### 11.2 Retrieval

Some Resources require a bounded capability to retrieve external material.

Examples:

- a current official link;
- contact information;
- a map/location;
- a source document;
- an image or video;
- current form/document availability.

Operational retrieval success is not factual admission. Where correctness of retrieved information matters, the relevant semantic owner—normally V36 for external facts—must admit or otherwise qualify it before the Resource is presented as established fact.

### 11.3 Generation

Some Resources are generated from accepted Product state.

Examples:

- prepared messages;
- generated documents;
- reports;
- checklists;
- comparison artifacts;
- forms populated with known data;
- media artifacts.

Generation is a capability operation when it requires model/tool/external processing. It must remain bounded by the Execution and Capability Architecture.

## 12. Resource-producing capabilities

A Resource producer is not a new top-level authority subsystem by default.

The Product owner that requests the Resource remains responsible for its semantic basis. Execution Runtime controls bounded capability execution. The producer normalizes the resulting payload into the Resource contract.

A Resource-producing CapabilityGrant follows the same rule as every other grant:

> **The grant is a bounded execution license, not unconditional authority to execute or to make the result authoritative.**

The Resource architecture may reference capability/result provenance, but it does not create a parallel execution framework.

## 13. Hydration

Heavy, expensive, sensitive, or externally backed Resource payloads should normally use lazy hydration.

The stable sequence is:

```text
presentation / Resource list
       |
       | lightweight descriptor only
       v
ResourceDescriptor
       |
       | explicit user opening/use or Product need
       v
hydrate(Resource ID, expected Resource version)
       |
       +--> ownership check
       +--> exact-version check
       +--> basis-compatibility check
       +--> content/source-validity check where required
       +--> availability check
       +--> capability policy if new external work is required
       +--> payload load/generation/retrieval
       v
HydratedResource
```

Hydration must not be treated as a free-form model callback or arbitrary URL fetch.

## 14. Hydration and stale protection

Current source requires `presentationRevision` when hydrating current presentation Resources and returns `PRESENTATION_STALE` if the projection changed.

That is a valid current stale-view guard, but the permanent Resource architecture must not rely only on presentation revision.

As Resources become independently versioned or reusable beyond one presentation snapshot, hydration should bind to:

```text
resourceId
expectedResourceVersion
owned Conversation / subject root
material Resource dependencies
optional presentationRevision
```

A changed presentation does not necessarily invalidate the Resource. A current presentation also does not prove the Resource's underlying source is still valid.

If the exact Resource version is not safe for the requested current use, hydration fails explicitly, returns historical-only status where applicable, or returns/references a replacement Resource version. It must not silently serve obsolete actionable payload as current.

## 15. Resource lifecycle

Resource **version state** and current **availability/validity evaluation** are related but not identical.

A useful conceptual lifecycle for logical Resource continuity is:

```text
need identified
    |
    v
PREPARING
    |
    +--> ResourceVersion N created
             |
             +--> currently usable
             +--> historical-only / superseded for active use
             +--> unavailable
             +--> retired from active Product state
             |
             +--> successor ResourceVersion N+1
```

The old version is not rewritten merely because a new version exists.

Presentation may hide obsolete or historical Resource versions, but hiding does not itself delete their retained provenance or payload.

## 16. Persistence and reconstruction

The State and Persistence Architecture requires persistence to preserve needed state without creating a second semantic authority. Resource persistence therefore uses a **class-based rule**, not a blanket “persist Resources” rule.

### 16.1 Reconstructible descriptor/projection

If a Resource descriptor and payload are deterministically reproducible from retained canonical state with no material loss, they should normally remain reconstructible/derived.

Examples may include:

- a criteria summary from an immutable DecisionPlan;
- a comparison projection from an exact retained StructuredDecision and evidence basis;
- static presentation labels around a Resource.

A cache is permitted when exact basis and invalidation metadata are retained. The cache remains discardable.

### 16.2 Retrieved immutable payload

If Lattice promises continuity for a retrieved source payload that may later disappear or change, preserving only a URL is insufficient.

Where retention is lawful and Product-required, persist the exact retrieved payload or immutable content identity plus provenance needed to reproduce what the user actually received.

External factual currentness remains governed by V36/source validity; retained historical bytes do not make the old source currently true.

### 16.3 Generated non-deterministic artifact

If the user is promised the same generated artifact after reconnect and deterministic regeneration cannot be guaranteed from retained inputs/configuration, persist the exact artifact or immutable generation result.

Persisting it does not make generated claims authoritative.

### 16.4 User-edited draft Resource

If Lattice promises continuity for edits to a prepared message, form, checklist, or other draft, the edited draft becomes durable **user/application content state** when saved.

It must be versioned and provenance-bearing, but it does not become canonical IntentVersion merely because the user edited it. Only the qualified Intent Authority intake path can turn user-authored meaning into canonical intent.

### 16.5 ActionProposal state

An ActionProposal used only as ephemeral preview may be reconstructed when exact reconstruction is guaranteed.

Before a consequential action can rely on an ActionProposal across restart, retry, or authorization, the exact proposal identity/version/digest and required binding state must be durable enough to prove what was authorized and what was dispatched.

This is a future requirement on the action bridge; it does not claim the current implementation already has a qualified action-authorization record.

### 16.6 Authorization and operation evidence

When a future consequential-action authorization contract exists, authorization evidence must bind an exact ActionProposal version/digest and must survive at least long enough to make dispatch/recovery auditable and retry-safe.

Execution Runtime's operation/result records retain operational provenance under the Execution and Capability Architecture.

### 16.7 Ephemeral interaction state

Open/closed state, scroll position, hover/focus, unsaved editor state, and similar interaction details remain client-ephemeral unless a specific Product continuity promise makes one of them durable.

## 17. Deletion and purge

Resources attached to a deleted Conversation must immediately become inaccessible through normal Product paths.

Deletion must cover or sever access to Resource payloads, generated artifacts, saved drafts, ActionProposal state, caches, indexes, and capability-result references according to the controlling M8 deletion/purge policy.

A Resource being externally hosted or generated by a provider does not remove Lattice's obligation to honor its Product-side ownership/deletion boundary.

Provider-side retention remains a separate provider/privacy contract.

## 18. Resource use capabilities

A Resource may expose application-issued **ResourceUseCapability** values. These describe allowed ways to interact with the Resource; they are not Execution Runtime `CapabilityGrant` objects and are not free-form model commands.

Examples include:

```text
VIEW
COPY
DOWNLOAD
PLAY
OPEN_EXTERNAL
SHOW_LOCATION
EDIT_LOCAL_DRAFT
USE_AS_INPUT
PRINT_OR_EXPORT
PREPARE_ACTION
```

Capabilities must be derived from Product-owned policy and the exact Resource kind/version/state.

A Resource payload must not be able to add arbitrary capabilities by embedding strings or model output.

### 18.1 ResourceUseCapability is not effect classification

A label such as `OPEN_EXTERNAL` does not prove the operation is consequence-free. It may cause network requests, reveal data to another origin, or trigger external application behavior.

The application must classify any underlying executable capability using the Execution and Capability Architecture. UI labels are not side-effect authority.

## 19. Preparation versus target execution

The most important action boundary is:

```text
prepare target action != perform target action
```

Examples of preparation include:

- draft an email or message;
- populate a form locally;
- assemble a checklist;
- generate a document;
- prepare a calendar-event proposal;
- prepare routing/directions;
- assemble order/request details;
- identify the correct contact;
- prepare structured inputs for a later capability.

Preparation may be reviewed, edited, copied, exported, or discarded.

None of that alone authorizes:

```text
SEND
SUBMIT
SCHEDULE
PURCHASE
TRANSFER
DELETE_EXTERNAL
PUBLISH
CHANGE_PERMISSION
EXECUTE_CONSEQUENTIAL_ACTION
```

Producing the prepared Resource may itself require model/provider execution or external data access. Those operations remain independently subject to capability, privacy, cost, egress, and evidence rules.

## 20. ActionProposal

When a Resource is intended to bridge into a later external action, Lattice should represent the proposed action explicitly rather than smuggling execution semantics into the Resource itself.

Conceptually:

```ts
interface ActionProposal {
  actionProposalId: string;
  actionProposalVersion: string;
  proposalDigest: string;
  resourceId?: string;
  resourceVersion?: string;
  basis: ResourceBasis;
  capabilityId: string;
  capabilityVersion: string;
  effectKind: "OBSERVE" | "EXTERNAL_PROCESSING" | "MUTATE";
  consequenceClass: "ROUTINE" | "CONSEQUENTIAL";
  reversibility: "REVERSIBLE" | "IRREVERSIBLE" | "UNKNOWN";
  idempotency: "IDEMPOTENT" | "NON_IDEMPOTENT";
  exactArguments: unknown;
  authorizationRequirement: ActionAuthorizationRequirement;
}
```

An ActionProposal is prepared execution input, not execution authority.

### 20.1 Proposal immutability

Once an ActionProposal version is presented for authorization or dispatch, its execution-significant content is immutable.

Any change to:

- recipient/target;
- action kind;
- exact arguments;
- attached Resource version;
- consequence/effect classification;
- capability identity/version; or
- material Product basis

creates a new ActionProposal version/digest.

The old proposal may remain historical but cannot be treated as authorization for the successor.

### 20.2 Proposal digest

The proposal digest binds the exact execution-significant representation, not presentation prose. A future authorization record should bind that digest or an equivalent exact immutable proposal identity.

Presentation rewording that does not change executable meaning need not change the digest. Any executable semantic change must.

### 20.3 Proposal readiness is not authorization

An ActionProposal does not execute merely because:

- the Resource is visible;
- the Resource is opened;
- the person chose a recommended option;
- the person confirmed intent meaning;
- the model emitted a tool call;
- a CapabilityGrant exists;
- the proposal has all required arguments; or
- a previous version of the proposal was authorized.

## 21. Action authorization

The Execution and Capability Architecture intentionally leaves the exact future consequential-action authorization contract to separately qualified Product design.

This Resource architecture preserves that boundary.

For consequential actions, execution must require a separately valid exact authorization tied to the current ActionProposal version/digest and current Product basis.

The architecture must distinguish:

```text
USER semantic confirmation
Decision Engine final-choice delegation
Resource preparation/editing
ActionProposal readiness
consequential external-action authorization
Execution Runtime capability license
actual execution result
```

None of those states should be silently collapsed.

### 21.1 Authorization invalidation

A future action authorization must fail closed when the execution-significant proposal changes after authorization.

At minimum, authorization must be re-evaluated or invalidated when:

- ActionProposal version/digest changes;
- target or exact arguments change;
- Resource basis becomes incompatible;
- required source/evidence validity is no longer sufficient;
- subject/Conversation ownership is unavailable or deleted;
- capability/effect classification changes; or
- the authorization's own validity window or scope expires.

### 21.2 Pre-dispatch recheck

Immediately before dispatch, Runtime must receive or derive enough exact binding material to verify:

```text
current subject / Conversation ownership
current proposal version/digest
current Resource version where applicable
current basis compatibility
required factual/source validity
required authorization
exact CapabilityGrant / policy state
remaining budgets and cancellation state
```

A successful earlier authorization does not waive the final Runtime gate.

## 22. Routine versus consequential use

Not every Resource use requires a consequential-action authorization workflow.

Viewing, copying, downloading, playing, opening an external URL, or showing a map can often remain ordinary Resource use, subject to privacy/security policy and any external effects.

However, even apparently simple interactions may cross into capability execution when they cause external processing, network requests, data disclosure, or state mutation. The implementation must classify the underlying capability using the Execution and Capability Architecture rather than relying on the button label.

## 23. External handoff

Some Resources must leave Solandra—for example an official external form or site that Lattice cannot safely embed or execute.

An external handoff should preserve:

- destination identity;
- why the handoff is needed;
- material validity/freshness warnings;
- what data will or will not be transferred;
- whether the user must perform the action manually; and
- enough context to return to Solandra without losing Product state.

Opening an external destination is not proof that an external action succeeded.

## 24. Prepared messages

Prepared messages deserve explicit safeguards because they are both content and action precursors.

A Prepared Message Resource should be able to represent:

```text
recipient proposal
channel proposal
subject/title
body/content
attachments or Resource references
source/basis provenance
editable fields
validity state
```

Editing it creates a new Resource version or saved-draft version as required by Section 7.

The person may edit it without silently modifying canonical IntentVersion unless the edited content is separately submitted as USER meaning through the normal Intent Authority path.

Sending requires a separately licensed execution capability and, when consequential, exact action authorization bound to the current ActionProposal version.

## 25. Forms and structured inputs

Form Resources may collect user data or prepare external submissions.

The architecture must distinguish:

1. **draft form state** — local/Resource preparation;
2. **Product semantic input** — information intentionally submitted into Lattice and routed to the owning semantic subsystem;
3. **external form submission** — action execution against another system.

Typing into a draft form does not automatically mutate IntentVersion. Submitting to Lattice may create a new USER-provenance event only through the qualified intake contract. Submitting externally requires the applicable execution/authorization boundary.

An edit that changes executable form submission content creates a new ActionProposal version/digest before authorization or execution.

## 26. Comparison Resources

A Comparison Resource must remain a presentation/projection over exact authoritative inputs.

It may include:

- eligible options;
- hard-requirement states;
- meaningful differences;
- priority-sensitive comparisons;
- frontier membership;
- selected outcome only where valid;
- evidence uncertainty; and
- links to deeper evidence.

Visual ordering, emphasis, generated prose, or a “best” label may not fabricate recommendation/winner authority absent Decision Engine state.

## 27. Evidence and source Resources

A Resource may expose evidence, provenance, or source material for deeper inspection.

A source Resource is not automatically admitted evidence merely because it is shown. Where the Resource is intended to communicate established factual support, it must point to the exact V36-owned admitted state.

Raw retrieved material may be shown as raw/source material only with truthful status and without pretending V36 has admitted it.

## 28. Generated Resource truth boundary

Generation can improve usability without increasing semantic authority.

A generated document or message may:

- summarize accepted Product state;
- reorganize admitted facts;
- translate or format content;
- prepare user-facing action material.

It may not silently:

- invent USER requirements;
- turn model inference into accepted intent;
- convert unadmitted claims into facts;
- convert frontier membership into a winner;
- convert a recommendation into action authorization; or
- claim an external action occurred.

## 29. Interaction with Solandra Composer

The Primary Interaction Contract determines whether a Resource should be presented and how it occupies the Composer.

The Resource architecture intentionally does **not** prescribe:

- card layout;
- permanent Resource trays;
- icons;
- navigation chrome;
- visual hierarchy;
- one specific Resource-opening animation; or
- desktop/mobile geometry beyond the UI contract.

A substantial Resource may take over the Composer while Conversation and conversation input remain available. That is presentation state only.

Opening/closing a Resource does not create a Product semantic phase.

## 30. Resource selection is not action selection

Selecting a Resource means “show/use this supporting material.”

It does not necessarily mean:

- the person accepts a recommendation;
- the person chooses a winner;
- the person authorizes a transaction;
- the person confirms USER intent; or
- the person authorizes capability execution.

The UI must use semantically specific controls where those meanings matter.

## 31. Reconnect and restoration

Reconnect reconstructs the newest authoritative presentation and current Resource descriptors from durable Product state plus any intentionally persisted Resource state.

Temporary client state may include:

```text
openResourceId
openResourceVersion
presentationRevision
compatible scroll/focus state
local unsent edits where explicitly supported
```

Restoration must verify that the Resource version remains accessible and compatible with the requested current use.

A Resource can be restored as historical-only without being restored as currently actionable.

If a Resource became invalid for the active action while open, reconnect must not resurrect obsolete actionable content as current.

## 32. Resource updates while open

When underlying Product state changes while a Resource is open:

- unchanged compatible Resource versions may remain open;
- changed Resources produce successor versions rather than in-place mutation where version identity matters;
- factually current but no-longer-relevant Resources may be retained as historical/reference material without implying active recommendation;
- source-invalid Resources must not remain current merely because their basis is still relevant;
- retired Resources should exit active presentation;
- unsaved local edits should not be silently overwritten where an edit contract exists; and
- stale/invalid content must not continue to imply current authority.

The UI may explain the update, but the application determines validity and compatibility.

## 33. Failure and recovery

Resource failure is not the same as semantic failure.

### 33.1 Preparation/retrieval failure

If a Resource producer fails, current availability changes according to bounded retry policy. Runtime owns operational recovery for capability failures.

### 33.2 Semantic insufficiency

If the Resource depends on unverified external information, V36 determines whether more evidence is needed. The Resource layer cannot declare the missing claim true just to finish preparation.

### 33.3 Invalid or superseded basis

If intent/decision/truth dependencies change materially, current Resource use is re-evaluated rather than attaching an old result to successor state.

### 33.4 Ambiguous action completion

If a Resource bridges to a non-idempotent external action and completion is ambiguous, Runtime follows the Execution and Capability Architecture. The Resource UI must not invite blind duplicate execution.

The exact ActionProposal/operation identity used for the attempt must remain available to recovery logic.

## 34. Current implementation alignment

Current canonical source already demonstrates useful pieces of this architecture:

- `ResourceDescriptor` is application-owned, not model-authored UI state;
- current kinds include text, link, contact, image, video, audio, document, map, and generated artifact;
- current purposes include resolving a knowledge gap, supporting understanding, and enabling a next action;
- current status includes available/loading/stale/unavailable;
- current capabilities are limited to copy/download/play/open-external/show-location;
- `HydratedResource` is separate from the lightweight descriptor;
- current hydration is application-owned rather than arbitrary model execution;
- presentation/resource APIs establish authenticated Conversation ownership before child access;
- hydration requires expected `presentationRevision` and fails with `PRESENTATION_STALE` when the projection has changed;
- current tests reject undeclared/model-script Resource IDs and verify Resource provenance/capability restrictions; and
- the State and Persistence Architecture already classifies hydrated presentation Resources as derived/reconstructible state.

## 35. Current implementation limitations

The current implementation is deliberately narrow and must not be mistaken for the permanent Resource contract.

Today:

- only text and text/plain generated-artifact hydration are implemented;
- generated Resources are currently hard-coded from completed decision state;
- Resource identity is effectively presentation-derived;
- no first-class durable Resource version/lifecycle store exists;
- no general Resource-producing capability contract exists;
- no prepared-message/checklist/form/comparison payload schemas exist as first-class Product contracts;
- no permanent multi-axis Resource validity model independent of `presentationRevision` exists;
- no ActionProposal identity/version/digest model exists;
- no general prepared-action-to-execution bridge exists; and
- current presentation code still carries older `knowledge_gap` / `actionable` semantic-phase names that the newer Owner-approved Solandra interaction contract supersedes as user-facing phases.

Those are implementation facts, not architecture blockers.

## 36. Migration direction

The smallest coherent long-term evolution is:

### Stage 1 — stabilize Resource contract

Extract Resource kinds, basis, versioning, provenance, multi-axis validity, subject ownership, hydration, and ResourceUseCapability semantics from presentation-specific code into application-owned Resource contracts.

### Stage 2 — broaden pure/derived Resource adapters

Add deterministic Resource payload adapters such as prepared text, checklist, comparison, and generated document forms that require no target consequential action.

### Stage 3 — bounded Resource-producing capabilities

Route retrieval/generation that requires external/model/tool execution through Execution Runtime under exact CapabilityGrants and result provenance.

### Stage 4 — durable Resource continuity where justified

Persist retrieved/generated/user-edited Resource versions only where continuity, non-determinism, source disappearance, user expectation, or safe recovery requires durable availability. Keep deterministic projections reconstructible by default.

### Stage 5 — versioned ActionProposal boundary

Introduce explicit immutable/versioned action proposals and proposal digests without enabling consequential execution by default.

### Stage 6 — separately qualified action execution

Only after the Product action-authorization contract is qualified should consequential send/submit/schedule/purchase/etc. execution be connected. Authorization must bind the exact proposal version/digest and survive/recover safely enough for the execution contract.

## 37. Anti-collapse invariants

Future Resource/action work must preserve:

1. `Resource != UI component`.
2. `ResourceDescriptor != hydrated payload`.
3. `Resource provenance != semantic authority transfer`.
4. `Resource exists != Resource should be shown`.
5. `Resource shown != recommendation accepted`.
6. `Resource selected != selected outcome`.
7. `Resource selected != USER intent confirmation`.
8. `Prepared message != sent message`.
9. `Prepared form != submitted form`.
10. `Generated artifact != verified fact`.
11. `Retrieved source != V36-admitted evidence`.
12. `ActionProposal != execution authorization`.
13. `ActionProposal version N authorization != authorization of version N+1`.
14. `CapabilityGrant != unconditional execution permission`.
15. `Decision Engine final-choice delegation != external-action authorization`.
16. `USER semantic confirmation != external-action authorization`.
17. `Presentation revision != permanent Resource version`.
18. `Resource version != ActionProposal version`.
19. `Resource ID != access capability`.
20. `Cached payload != current valid payload`.
21. `Basis relevance != source/content validity`.
22. `Source/content validity != availability`.
23. `Open external != action succeeded`.
24. `Idempotent != consequence-free`.
25. `Reversible != non-consequential`.
26. `Resource persistence != Resource semantic authority`.
27. `Resource preparation failure != evidence against the underlying claim`.
28. `Opening/closing Resource != semantic phase transition`.
29. `Editing a prepared Resource != canonical IntentVersion mutation`.
30. `Preparation != no external processing`.

## 38. Validation design

Future exact-revision probes should demonstrate at least:

1. Resource list is derived from accepted Product state rather than model/DOM input;
2. guessed Resource IDs cannot bypass authenticated Conversation ownership;
3. cross-subject Resource hydration fails without useful object-existence leakage;
4. stale presentation revision cannot hydrate against a mismatched current projection in the current API;
5. a current presentation revision does not by itself prove source/content validity;
6. immutable Resource version can be distinguished from a later successor version;
7. source-current but basis-superseded Resource can be represented without conflating the two states;
8. basis-current but source-expired Resource can be represented without conflating the two states;
9. temporary hydration failure does not rewrite factual validity;
10. Resource producer result retains exact capability/run/provenance identity;
11. generated factual artifact cannot strengthen unadmitted claims;
12. Comparison Resource cannot fabricate a winner absent StructuredDecision authority;
13. prepared message can be edited/copied without sending;
14. editing execution-significant prepared content creates a new Resource/ActionProposal version as applicable;
15. prior authorization cannot execute a changed ActionProposal digest;
16. prepared form can be edited without external submission;
17. Resource payload cannot self-authorize arbitrary `send`, `submit`, `purchase`, `schedule`, or `execute` capabilities;
18. ResourceUseCapability is application-issued and kind/policy constrained;
19. external Resource retrieval respects capability egress/budget/cancellation policy;
20. late Resource generation after basis invalidation cannot attach as current action material;
21. deletion immediately removes normal access to owned Resource payloads/drafts/proposals;
22. reconnect restores only Resource state compatible with current access and use basis;
23. retained historical Resource does not present itself as currently actionable;
24. cached Resource payload cannot outrank newer dependency/validity state;
25. failed Resource retrieval does not become negative V36 evidence;
26. ActionProposal readiness does not execute an external mutation;
27. semantic confirmation does not authorize unrelated action execution;
28. Decision Engine delegation does not authorize unrelated action execution;
29. ambiguous non-idempotent action completion does not invite blind retry;
30. exact ActionProposal/operation identity is preserved for recovery;
31. Resource-opening presentation state does not mutate canonical Product state; and
32. substantial Resource takeover remains faithful to the controlling Solandra interaction contract.

Passing these probes establishes bounded Resource/action behavior only for the exact tested revision and scope. It does not establish production readiness or general authorization for consequential actions.

## 39. API direction

Current routes may continue to serve as the initial seam:

```text
GET /api/v1/conversations/:conversationId/presentation
GET /api/v1/conversations/:conversationId/presentation/resources/:resourceId
```

As Resources become independently versioned/durable, the Product may introduce an application-owned Resource route equivalent to:

```text
GET /api/v1/conversations/:conversationId/resources/:resourceId?resourceVersion=...
```

without requiring Resources to remain presentation-owned.

A future action bridge should use explicit proposal/authorization/execution contracts rather than overloading Resource hydration.

Conceptually:

```text
POST .../resources/:resourceId/action-proposals
GET  .../action-proposals/:id?version=...
POST .../action-proposals/:id/authorize
POST .../action-proposals/:id/execute
```

The exact route shapes are illustrative. The semantic separation and exact-version binding are normative; route design remains an implementation choice for later bounded Work Items.

## 40. Relationship to Solandra UI

Solandra's Composer remains the ordinary presentation surface for useful Resources.

This architecture enables the UI contract without becoming the UI contract.

The application determines:

- which Resource version is current for a requested use;
- whether its basis remains relevant;
- whether source/content validity remains sufficient;
- whether it is available to hydrate;
- whether it belongs to the authenticated Product graph;
- what provenance supports it;
- which non-authorizing ResourceUseCapability values are available; and
- whether a prepared action needs a separate ActionProposal/authorization/execution step.

The UI determines how that valid application state is rendered and temporarily navigated.

## 41. Structural summary

```text
Intent Authority / V36 / Decision Engine / Runtime
                    |
                    | authoritative state
                    v
             Resource need/basis
                    |
          +---------+----------+
          |                    |
          v                    v
     pure projection      bounded capability
          |                    |
          |                    v
          |              operational result
          |                    |
          +---------+----------+
                    |
                    v
          ResourceDescriptor/version
                    |
        +-----------+------------+
        |           |            |
        v           v            v
 basis relevance  source validity  availability
        \           |            /
         \          |           /
          +---------+----------+
                    |
                    v
             HydratedResource
                    |
       +------------+-------------+
       |                          |
       v                          v
 inspect/copy/use            ActionProposal vN
                                  |
                              exact digest
                                  |
                         separate authorization
                                  |
                         Runtime final policy gate
                                  |
                                  v
                           action result/provenance
```

The permanent ownership rule is:

> **Resources package useful Product-grounded material for a person. Resource validity remains multi-dimensional; preparation can be broad and helpful without authorizing the target action; execution remains separately licensed, authorized where required, and owned by Execution Runtime.**

## 42. Reconciliation findings and next use

This document is a reconciled Owner-directed draft against canonical `main @ c7effc72b8efd942ff566d1d80b3d0e15f3e6301`.

Dedicated reconciliation made three material corrections to the first draft:

1. **Resource freshness is now multi-axis.** Basis relevance, source/content validity, and availability are independent so a Resource can remain historically valid without being actionable, or remain relevant while one live source requires refresh.
2. **ActionProposal is now explicitly versioned and digest-bound.** Execution-significant edits create a successor proposal; authorization of one proposal version cannot transfer to another.
3. **Persistence is now class-based.** Deterministic projections remain reconstructible by default; retrieved/generated/user-edited/action state is persisted only where continuity, non-determinism, disappearance, user promise, authorization, or recovery requires it.

The permanent Product commitments proposed here are:

- Resource identity/version and validity are application concepts independent of `presentationRevision`;
- subject access remains rooted in authenticated Conversation ownership;
- Resource producers use existing Execution Runtime capability boundaries rather than a new autonomous tool system;
- preparation is distinct from performing the target action, while still respecting any external-processing/privacy/cost effects required to prepare;
- `ActionProposal` is the explicit immutable/versioned bridge from prepared Resource material to future authorized execution; and
- consequential execution remains blocked until its separately qualified action-authorization contract exists.

This draft changes no runtime code, persistence schema, provider configuration, production state, secrets, paid infrastructure, or consequential external action.
