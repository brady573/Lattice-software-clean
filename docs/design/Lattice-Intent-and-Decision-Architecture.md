# Lattice Intent and Decision Architecture

Status: **RECONCILED DRAFT — Owner-directed cross-system semantic architecture**

Drafted: **August 31, 2026**

Repository reconciliation baseline: `main @ 8c893bb8b0132b87837a6740709dc1dfff79e44a`, tree `82e8095861c155c6d2e1e46eb2b63939b4f3f130`.

## 1. Purpose

Lattice is a Trusted Decision Product. Its central semantic boundary is the boundary between **what the USER means** and **what Lattice concludes from that meaning plus qualified evidence**.

This document defines that relationship end to end:

```text
conversation / USER input
        |
        v
interpretation proposal
        |
        +--> clarification / exact USER confirmation when material
        |
        v
canonical IntentVersion
        |
        v
DecisionPlan
        |
        +-----------------------------+
        |                             |
        v                             v
qualified Criterion Catalog      V36 qualified evidence
        |                             |
        +-------------+---------------+
                      |
                      v
             Lattice Decision Engine
                      |
          eligibility / comparison
                      |
                      v
              StructuredDecision
                      |
                      v
             Solandra presentation
```

The central rule is:

> **USER meaning and Product judgment compose, but they are not the same semantic state.**

- **Lattice Intent Authority** answers what the USER means, requires, prefers, permits, corrects, or delegates.
- **V36 Truth Core** answers what external factual claims are supported and with what uncertainty.
- The **qualified Criterion Catalog** supplies Product/domain criterion semantics.
- The **Lattice Decision Engine** answers what follows from the exact intent, criterion semantics, and admitted evidence.
- **Solandra Experience** communicates and advocates around those states without acquiring their authority.

This separation prevents UI, model, persistence, orchestration, or presentation work from silently converting interpretation into intent, facts into preferences, preferences into requirements, uncertainty into certainty, a recommendation frontier into a forced winner, or USER confirmation into blanket authority.

## 2. Authority and relationship to other design sources

This is a cross-system semantic architecture. It does not replace the subsystem-specific Product authorities that define Intent Authority, V36, Decision Engine, persistence, or Solandra behavior.

It must remain consistent with, and is subordinate at their applicable boundaries to:

- `Lattice-Foundational-Design-Principle.md` — first Product-design filter;
- `Lattice-Living-Software-Design-to-1.0.md` plus confirmed amendments — canonical forward Product direction;
- `Lattice-Owner-Decisions-OD-001-to-OD-004.md` — Owner-confirmed Intent Authority, V36 continuation, Decision Engine, and Trusted Decision Product semantics;
- `Lattice-Owner-Decision-OD-007-M8-Continuity.md` — continuity and reusable preference boundaries;
- protected V36 specifications — controlling epistemic semantics;
- `Lattice-Architecture-Integrity.md` — protected semantic ownership boundaries;
- `Lattice-System-Registry-and-Naming.md` — canonical subsystem vocabulary;
- `Lattice-System-Architecture.md` — current implementation structural map; and
- `Lattice-State-and-Persistence-Architecture.md` — cross-system state ownership, versioning, reconstruction, and second-source-of-truth rules.

The current Solandra UI design remains a presentation-layer input and may evolve independently. This document intentionally does **not** treat current UI labels, layout, hierarchy, navigation, or visual metaphors as semantic authority. Future UI work must reconcile to the semantic boundaries here; this architecture must not freeze an in-progress presentation design.

If a future qualified subsystem design changes one of these semantics, this document must be reconciled rather than treated as authority to override that design.

Where current implementation is narrower than this architecture, this document states the required semantic boundary without claiming the missing behavior is already implemented.

## 3. Canonical semantic pipeline

The canonical semantic path is:

```text
USER expression
  -> persisted USER provenance
  -> interpretation / ProposedIntentDelta
  -> provenance + materiality + freshness + representability checks
  -> clarification or exact USER confirmation when required
  -> immutable canonical IntentVersion
  -> faithful immutable DecisionPlan for one Run
  -> qualified criterion bindings
  -> V36-admitted evidence
  -> Decision Engine eligibility / comparison / frontier
  -> StructuredDecision
  -> faithful Solandra presentation
```

No arrow transfers semantic authority merely because data crosses a boundary.

### 3.1 Conversation and interpretation

Conversation text is input and provenance. A model, deterministic parser, Solandra, specialist, or other qualified interpreter may propose structured meaning.

That proposal is **not** canonical USER intent.

Material ambiguity remains pending until Intent Authority establishes authoritative USER meaning through explicit USER-origin semantics or exact USER confirmation.

### 3.2 Canonical intent

A committed `IntentVersion` is immutable structured USER meaning within an `IntentScope`.

It contains or binds the decision-relevant USER semantics downstream work may rely on, including objective, representable hard requirements, priority/preference state, tolerances, conditions, corrections, and delegation where qualified.

### 3.3 Planning boundary

`DecisionPlan` freezes a faithful projection of one exact `IntentVersion` for one Run.

DecisionPlan is not a second interpretation layer, an editable copy of intent, or a new Product authority.

### 3.4 Evidence boundary

External-world claims required to evaluate the decision enter through V36 Truth Core.

Provider output, retrieval results, model output, worker results, transcript claims, or historical prose do not become decision facts merely because they are available.

### 3.5 Decision boundary

The Decision Engine consumes:

- exact authoritative intent/planning material;
- exact qualified criterion semantics; and
- V36-admitted evidence.

It evaluates hard requirements, eligibility, preference comparison, meaningful differences, coverage/unknowns, trade-offs, material dominance, tie/outcome state, and any authorized delegated selection.

### 3.6 Presentation boundary

Solandra presents understanding, evidence, uncertainty, alternatives, recommendation state, reasons, and any valid selected outcome.

Presentation may adapt wording, composition, ordering, and interaction to the USER, but it may not alter canonical intent, evidence strength, eligibility, frontier membership, or selected-outcome authority.

## 4. Semantic vocabulary

The following concepts must remain distinct across implementation, APIs, persistence, model prompts, and presentation.

| Concept | Meaning | Semantic owner | What it is not |
| --- | --- | --- | --- |
| **Objective** | What decision or outcome the USER is trying to accomplish | Intent Authority | A candidate, fact, requirement, recommendation, or action authorization |
| **Requirement** | USER meaning that an option must satisfy for the represented decision | Intent Authority for USER meaning | Merely a strong preference or an observed fact |
| **Preference** | USER meaning about relative desirability among otherwise viable outcomes | Intent Authority | A hard eligibility rule, evidence claim, or model guess |
| **Constraint** | An authoritative restriction applied during decision evaluation from qualified intent/domain semantics | Decision Engine evaluates it; source authority remains with the system that established the restriction | A synonym for every requirement, preference, or operational limit |
| **Uncertainty** | Explicit lack of sufficient resolution in a bounded semantic domain | Owning subsystem for that domain | Permission to guess or collapse UNKNOWN to false/zero |
| **Fact / evidence** | External-world material admitted under protected truth semantics | V36 Truth Core | USER preference, system output, or recommendation |
| **Recommendation** | Authoritative Decision Engine decision-support state, normally represented by the material-dominance frontier plus structured reasons | Decision Engine | Necessarily a single winner |
| **Winner / selected option** | One authoritative selected outcome only where valid decision state and authorization support selection | Decision Engine for delegated selection; USER may separately choose | A synonym for recommendation or Solandra emphasis |
| **USER confirmation** | Exact USER authorization of a specific pending semantic interpretation | Intent Authority | General approval of future inference, facts, recommendations, or actions |

These distinctions are architectural, not merely terminology preferences.

## 5. Objective

The **objective** states what the USER is trying to decide or accomplish through the decision.

Examples:

```text
"Choose among viable options for the USER's stated need."
"Determine the best available path under the USER's constraints."
"Decide which supported alternative best fits the confirmed priorities."
```

An objective establishes **what is being decided**. It does not establish every requirement, preference, criterion, fact, recommendation, selected option, or authorization.

A materially changed objective creates authoritative intent change and may create a new IntentScope or successor IntentVersion depending on qualified scope semantics.

UI navigation, model summaries, newly discovered candidates, or research results must not silently change the objective.

## 6. Requirement

A **requirement** is USER-authored or exactly USER-confirmed meaning that an option must satisfy for the represented decision.

Current generalized semantics represent hard requirements against qualified criterion identifiers and operators such as:

```text
criterionId
operator: LTE | GTE | EQ
expected
USER provenance
```

The USER meaning belongs to Intent Authority.

The Decision Engine separately evaluates whether a candidate satisfies that requirement using qualified criterion semantics and V36-admitted evidence:

```text
SATISFIED
FAILED
UNKNOWN
```

Requirement meaning and requirement outcome are different states.

A USER saying:

```text
"It must stay within the limit I specified."
```

may establish authoritative requirement meaning. The candidate's actual observed value and resulting requirement status are not established by that USER statement.

`UNKNOWN` cannot satisfy a hard requirement and is not zero utility.

## 7. Preference and priority

A **preference** expresses relative USER desirability rather than absolute eligibility.

Current generalized semantics use qualified criterion identifiers and priority tiers:

```text
MUST_HAVE
MATTERS_MOST
IMPORTANT
NICE_TO_HAVE
```

The criterion's domain semantics come from the qualified Criterion Catalog. The USER's priority meaning comes from Intent Authority.

### 7.1 Preference is not requirement

`"Reliability matters a lot"` does not automatically mean `"Reject anything below an unstated reliability threshold."`

A preference can affect comparison without excluding an option. A hard requirement can exclude an option without implying a continuous preference beyond its threshold.

### 7.2 Critical terminology invariant: `MUST_HAVE` priority != hard requirement

The canonical Decision Engine design intentionally contains **both**:

1. a `MUST_HAVE` **priority tier** within the four-tier preference/priority model; and
2. separately represented **hard requirements** whose candidate outcomes are `SATISFIED | FAILED | UNKNOWN` and which determine eligibility.

Therefore:

> **`MUST_HAVE` as a priority tier does not, by itself, create a hard requirement or hard eligibility constraint.**

A criterion tagged `MUST_HAVE` remains within the priority/comparison model unless authoritative Intent Authority state separately represents a hard requirement for that criterion.

Conversely, a hard requirement does not automatically imply that the same criterion should also receive `MUST_HAVE` priority treatment beyond the hard boundary.

UI, model interpretation, API adapters, migrations, persistence transforms, or convenience schemas must never collapse these two representations because their labels appear semantically similar.

If USER language is materially ambiguous between:

```text
"this matters more than anything else"
```

and:

```text
"reject any option that fails this"
```

Intent Authority must preserve the ambiguity and clarify when the distinction could change eligibility or outcome.

### 7.3 Preference absence states

Intent Authority distinguishes states including:

```text
UNSPECIFIED
NO_PREFERENCE
OPEN
UNRESOLVED
DELEGATED
```

Silence is not automatically indifference. `NO_PREFERENCE`, `OPEN`, `UNRESOLVED`, and `DELEGATED` are not interchangeable.

## 8. Constraint

A **constraint** describes a restriction applied by the decision process to the admissible or valid outcome space.

For USER hard requirements:

```text
USER requirement meaning
        +
qualified criterion semantics
        +
V36 evidence
        |
        v
Decision Engine hard-constraint evaluation
        |
        v
SATISFIED | FAILED | UNKNOWN
```

A requirement describes USER meaning. Constraint evaluation describes decision effect.

Not every restriction is USER intent. Separately qualified domain validity rules, safety/security rules, Product capability boundaries, and operational limits retain their own authority.

Runtime budgets, provider limits, timeouts, or infrastructure availability are operational constraints. They are not USER requirements, V36 evidence, or Decision Engine preferences.

## 9. USER tolerance and meaningful difference

A USER tolerance describes how much difference the USER considers materially meaningful for a comparable criterion where the schema supports that meaning.

Ownership remains split:

- USER-specific tolerance meaning -> Intent Authority;
- criterion/domain comparison semantics -> qualified CriterionDefinition;
- observed values and evidence uncertainty -> V36;
- bounded compensation and meaningful-difference evaluation -> Decision Engine.

A model must not invent tolerance merely because two values look close.

## 10. Uncertainty

Lattice has multiple uncertainty domains. They must not collapse into one generic confidence score.

### 10.1 Intent uncertainty

Question: **What does the USER mean?**

Owner: Intent Authority.

Examples include ambiguity between requirement and preference, unclear scope, unrepresentable meaning, correction-versus-addition ambiguity, and unclear delegation scope.

Material intent uncertainty routes to clarification or exact confirmation.

### 10.2 Evidence uncertainty

Question: **What is actually known about the external world?**

Owner: V36 Truth Core.

Examples include missing coverage, conflicting sources, stale evidence, uncertain measurement, and unresolved contradiction.

Evidence uncertainty is not repaired by USER preference confirmation or model confidence.

### 10.3 Decision uncertainty

Question: **Given exact intent and admitted evidence, what outcome is supportable?**

Owner: Decision Engine for decision semantics.

Examples include multiple materially distinct frontier options, `UNKNOWN` hard-requirement status, incomplete preference coverage, differences within tolerance, or no safely dominant candidate.

Decision uncertainty is not necessarily a defect. A trustworthy result may be a frontier or explicit limitation rather than a forced winner.

### 10.4 Presentation and model confidence

Solandra may explain uncertainty from authoritative state but does not create a new uncertainty authority.

Model confidence is never a substitute for intent uncertainty, V36 evidence uncertainty, or Decision Engine outcome state.

## 11. Fact and evidence

A **fact** for decision purposes is an external-world proposition supported and admitted under V36 Truth Core semantics.

**Evidence** is provenance-bearing material V36 evaluates to establish or qualify such propositions.

A USER statement about the external world may identify something worth investigating, but it does not automatically become V36 truth.

Likewise:

- fact != USER preference;
- USER preference != fact;
- previously admitted historical fact != automatically valid current truth;
- persistence != renewed temporal applicability.

Historical evidence reuse remains subject to V36 semantics.

## 12. Interpretation

Natural-language input may be transformed into structured proposal material such as `ProposedIntentDelta` by deterministic logic, Solandra, models, or specialist guidance.

Interpretation may identify possible objective changes, requirements, priorities/preferences, tolerances, conditions, corrections, removals, delegation, scope changes, and unresolved meaning.

Interpretation does not commit canonical intent.

Current confirmed provenance/materiality semantics distinguish states including:

```text
EXPLICIT_USER
USER_REFERENCE
INFERRED_NON_MATERIAL
INFERRED_MATERIAL
UNRESOLVED
USER_CONFIRMED
```

Only persisted USER-origin meaning or exact USER confirmation may authorize canonical mutation.

Canonical semantic operations are:

```text
SET
REMOVE
NO_CHANGE
```

Omission never means removal.

## 13. Clarification and USER confirmation

Intent need only be materially sufficient, not exhaustively complete.

Clarification is required when unresolved USER meaning could materially change eligibility, planning, research requirements, criterion interpretation, preference comparison, delegation scope, or authoritative outcome.

USER confirmation binds an exact fresh pending semantic proposal, including its relevant scope/base-version/message-horizon/proposition identity.

A response such as `"yes"` authorizes only the exact unambiguous proposition it answers.

USER confirmation does **not** mean:

- broad approval of model inference;
- evidence admission;
- confirmation that a recommendation is correct;
- final-choice delegation unless that is the exact proposition confirmed;
- authorization to perform a consequential action; or
- generalized permission to remember the state across decisions.

Later clear USER correction creates immutable successor intent lineage rather than rewriting history.

## 14. Canonical IntentVersion

`IntentVersion` is the canonical immutable representation of accepted structured USER meaning for one IntentScope version.

It is not the transcript, a summary, a model context, a DecisionPlan, or presentation text.

Current generalized decision intent includes:

```text
intentScopeId
intentVersionId
objective
hardRequirements
priorities
tolerances
```

with USER provenance bound to authoritative fields.

Material unresolved interpretation remains outside confirmed canonical state until resolved under Intent Authority semantics.

Only genuine semantic change advances IntentVersion. Restatement, normalization, replay, rejected/stale proposals, semantic no-ops, or presentation wording changes do not independently justify version churn.

## 15. DecisionPlan

`DecisionPlan` is the durable exact binding between one accepted IntentVersion and faithful planning material used by one Run.

```text
IntentVersion
     |
     | faithful projection
     v
DecisionPlan
     |
     | exact Run binding
     v
Run
```

DecisionPlan has no independent semantic authority.

It does not decide what the USER meant, admit evidence, choose criteria, infer tolerances, select a winner, or rewrite canonical intent.

Its purpose is fidelity: later conversation or correction cannot silently change the semantics of an already-bound Run.

## 16. Qualified criterion semantics

The qualified Criterion Catalog supplies Product/domain semantics for criteria used by the Decision Engine.

A CriterionDefinition may establish criterion identity/version, value type, comparison direction, meaningful-difference behavior, and other qualified criterion semantics.

Current `DecisionInputSnapshot` construction resolves already-authoritative USER decision semantics against one exact qualified Criterion Catalog snapshot.

That construction does **not**:

- interpret natural language;
- infer USER priorities;
- admit evidence; or
- make a decision.

An exact decision input binds the applicable IntentVersion and criterion versions so later catalog changes cannot silently reinterpret historical decision input.

## 17. Evidence qualification for decision use

The Decision Engine may rely only on evidence admitted through the qualified truth contract.

Decision logic may not strengthen evidence because a candidate otherwise looks attractive.

Operational success is not evidence sufficiency. Model fluency is not evidence strength. USER preference strength is not evidence strength.

## 18. Eligibility

**Eligibility** answers whether a candidate remains valid under applicable hard constraints and qualified evidence state.

Eligibility is Decision Engine output, not USER intent.

Each hard requirement is evaluated as:

```text
SATISFIED
FAILED
UNKNOWN
```

A failed hard requirement cannot be compensated by preferences elsewhere. An unknown hard requirement cannot be treated as proven eligible merely because no failure has yet been found.

Where materially relevant, the Product should remain able to explain the exact IntentVersion requirement provenance, criterion definition, V36 evidence, and Decision Engine derivation that produced eligibility.

## 19. Comparison and preference evaluation

Eligibility asks: **Can this option remain in consideration?**

Comparison asks: **How do viable or unresolved options differ under the USER's confirmed preferences and qualified criteria?**

The Decision Engine evaluates USER priority tiers, utility where qualified, evidence coverage, USER tolerances, criterion meaningful-difference semantics, uncertainty, and bounded compensation across tiers.

Unknown preference utility is not converted to zero.

Equal influence within a priority tier is the default absent authoritative USER intent establishing another representable relationship.

Higher-tier differences dominate lower tiers only when meaningful under applicable qualified tolerance semantics.

## 20. Recommendation

A **recommendation** is authoritative decision-support state produced by the Decision Engine from exact intent, qualified criterion semantics, and admitted evidence.

Under current confirmed generalized semantics, the authoritative recommendation set is the **material-dominance frontier**: the strongest credible options not materially dominated under the current basis.

Each materially distinct frontier option retains structured reasons and trade-offs.

A recommendation is not necessarily one option.

Valid outcomes may include:

- one clearly dominant frontier option;
- several materially distinct frontier options;
- tie/outcome state;
- explicit unresolved limitations; or
- no safely recommendable option under the current basis.

Presentation must not fabricate a single winner merely because a simpler layout, narrative, or interaction would prefer one.

## 21. Winner and selected option

`winner` is valid only when authoritative decision state actually contains a selected outcome.

Lattice does not define every StructuredDecision as a winner record.

If Intent Authority records explicit USER final-choice delegation, the Decision Engine may produce an authoritative `DelegatedSelection` from the valid frontier.

```text
USER grants scoped final-choice permission
        |
        v
Intent Authority records delegation
        |
        v
Decision Engine computes valid frontier
        |
        v
Decision Engine may select within that frontier
        |
        v
DelegatedSelection
```

The selection is Lattice judgment under USER-delegated authority. It is not retroactively a USER preference.

The USER may also choose among presented options without delegating selection to Lattice.

Final-choice delegation never authorizes purchase, booking, submission, deletion, deployment, or another consequential external action.

## 22. StructuredDecision

`StructuredDecision` is authoritative Decision Engine output for one exact decision basis.

Its semantics may include:

- hard-requirement outcomes;
- eligibility;
- comparison/utility state;
- evidence/coverage limitations relevant to decision semantics;
- material-dominance frontier membership;
- structured reasons/trade-offs;
- tie/outcome semantics; and
- delegated selection / selected outcome only when authorized and valid.

StructuredDecision must remain attributable to:

```text
exact IntentVersion / DecisionPlan
exact qualified criterion bindings
exact V36-admitted evidence state
exact decision execution basis
```

Changed intent, qualified criterion semantics, or materially changed admitted evidence requires a new valid decision basis rather than in-place reinterpretation of an already-persisted decision.

Runtime persistence and Solandra rendering do not transfer decision authority.

## 23. Confirmation across the pipeline

The rule is:

> **USER confirmation grants authority only to the exact USER-meaning proposition being confirmed.**

It does not by itself mean:

- external facts are true;
- Lattice may choose arbitrary criteria;
- a recommendation is correct;
- Lattice may select a winner;
- a selected outcome may be executed externally; or
- a preference may be remembered across conversations.

Any confirmation affordance must therefore be bound to an exact visible or otherwise unambiguous proposition and current semantic basis when material.

## 24. Cross-concept examples

### Example A — requirement versus fact

USER:

```text
"It must be available by the required date."
```

- requirement meaning -> Intent Authority;
- required-date representation -> IntentVersion;
- criterion semantics -> Criterion Catalog;
- candidate availability -> V36 evidence;
- `SATISFIED | FAILED | UNKNOWN` -> Decision Engine;
- explanation -> Solandra.

The USER does not establish the candidate's actual availability by stating the requirement.

### Example B — `MUST_HAVE` priority versus hard requirement

USER:

```text
"Reliability is the most important thing to me."
```

That may support a high priority tier such as `MUST_HAVE` under qualified interpretation, but it does not necessarily authorize rejection of every option below an unstated threshold.

USER:

```text
"Anything below the minimum reliability level is unacceptable."
```

That may establish a hard requirement if faithfully representable.

If the USER's wording is ambiguous between priority and rejection threshold, Intent Authority clarifies rather than collapsing the two states.

### Example C — confirmation

Solandra may present the proposition:

```text
"I understand that meeting the stated limit is a hard requirement, not just a preference. Is that right?"
```

If the USER answers `"Yes"`, that confirmation may authorize exactly that fresh proposal-bound semantic change. It does not authorize unrelated inferred requirements, factual claims about observed values, final-choice delegation, or future external actions.

### Example D — uncertainty routing

If the USER's required date is clear but one candidate's availability by that date cannot be verified, that is not an intent clarification problem.

The required date remains authoritative intent. The availability gap is evidence uncertainty and routes to V36/research or explicit limitation.

### Example E — recommendation without winner

If two eligible options are materially distinct and neither dominates the other under confirmed priorities and tolerances, the valid StructuredDecision may preserve both on the material-dominance frontier.

Solandra should explain the trade-off rather than fabricate a winner.

## 25. Presentation and interaction semantic boundary

This section defines **semantic constraints on any presentation or interaction design**. It does not prescribe current or future UI labels, layout, navigation, visual hierarchy, orbital metaphors, component names, screen regions, or interaction patterns.

The Solandra UI is intentionally free to evolve so long as these Product-semantic boundaries remain intact.

### 25.1 Presenting current understanding

Any presentation of Solandra's current understanding may help the USER inspect, correct, or clarify meaning.

Such presentation must remain a faithful projection of canonical and pending Intent Authority state as appropriate to the interaction.

It must not become an independently mutable semantic store whose text outranks IntentVersion or pending-transition provenance.

The architecture does **not** require that this concept be labeled `What I understand`, shown in a specific region, or exposed through any particular control.

### 25.2 Clarification and confirmation interaction

Any interaction that confirms or corrects intent must bind the USER action to the exact proposition and current semantic basis where material.

A generic bulk confirmation is unsafe when materially independent or ambiguous propositions are bundled together.

The architecture does not prescribe how confirmation is visually rendered.

### 25.3 Evidence and uncertainty presentation

When confusion would be material, presentation should preserve distinguishability between:

- USER requirements/preferences;
- external evidence/facts;
- evidence uncertainty;
- eligibility/outcome state; and
- explanatory relevance.

Presentation may explain why information matters without converting relevance into USER preference or converting preference into fact.

No specific label such as `Why this matters` is required by this semantic architecture.

### 25.4 Recommendation and frontier presentation

Presentation may emphasize information to reduce cognitive load, but it may not:

- hide a materially distinct frontier option in a way that changes the authoritative recommendation state;
- turn `UNKNOWN` requirement evidence into a pass;
- label Solandra advocacy as USER preference;
- display a selected outcome where StructuredDecision contains none; or
- treat USER confirmation of intent as confirmation of the recommendation.

The presentation layer may choose how to make a multi-option frontier understandable. It may not force semantic collapse to a single option merely because a current or historical UI concept favors one dominant surface.

### 25.5 Evolving UI design

UI documents, prototypes, and interaction specifications may introduce presentation terminology, layouts, components, motion, or navigation patterns.

Those artifacts must be reconciled against this architecture when they touch objective, intent, requirement, preference, evidence, uncertainty, eligibility, recommendation, selection, confirmation, or authorization semantics.

Presentation evolution does not require changing this architecture unless the underlying Product semantics themselves are deliberately changed through qualified Product design.

## 26. Model and interpreter boundary

Model/provider output remains non-authoritative proposal material unless accepted through the owning subsystem's contract.

Models may assist with semantic parsing, candidate intent deltas, ambiguity detection, proposed clarification wording, explanation, presentation, option-case development, and identifying questions worth researching.

Models may not independently:

- commit IntentVersion state;
- convert silence into preference/delegation;
- change `OPEN` into `DELEGATED`;
- invent hard requirements;
- convert `MUST_HAVE` priority into a hard requirement;
- admit external facts;
- strengthen evidence confidence;
- change criterion semantics;
- alter frontier membership;
- select a winner without valid decision authority; or
- treat conversational agreement as broad authorization.

A more capable model changes capability, not Product authority.

## 27. Persistence boundary

The durable semantic graph must preserve the distinctions in this document.

The following must never become independently writable second sources of truth:

- transcript-derived objective/intent summaries;
- model-parsed requirements or preferences not accepted by Intent Authority;
- transformed schemas that collapse priority tiers and hard requirements;
- DecisionPlan copies used as editable intent;
- Run fields used as alternate truth/decision authority;
- cached candidate facts bypassing V36;
- explanation prose used to reconstruct StructuredDecision;
- UI labels used to infer winner state; or
- Solandra presentation text used instead of canonical intent lineage.

Restart/reconnect reconstruction should restore authoritative state from canonical intent, exact bindings, V36 state, and StructuredDecision, then reconstruct presentation.

## 28. Staleness and change propagation

Semantic changes invalidate downstream assumptions according to ownership rather than through one global mutable state.

- A new IntentVersion changes what is current for future work but does not mutate historical DecisionPlans/Runs.
- Material active-Run correction requires successor execution under qualified semantics.
- New or materially changed V36 evidence may require a new decision basis but does not rewrite USER intent.
- A new CriterionDefinition version does not silently reinterpret a previously materialized decision input.
- A new StructuredDecision does not retroactively change what the USER meant or what V36 previously admitted.
- A presentation revision does not imply changed intent, truth, eligibility, recommendation, or selected-outcome state unless the underlying authoritative basis changed.

## 29. Decision insufficiency routing

When Lattice cannot responsibly complete a decision, the unresolved issue routes to the authority that owns it.

| Gap | Route |
| --- | --- |
| What did the USER mean? | Intent Authority clarification/confirmation |
| Is this a hard requirement or only a priority/preference? | Intent Authority clarification/confirmation |
| What does this criterion mean for the domain? | Qualified Criterion Catalog / Product design |
| What is true about the candidate/world? | V36 research/evidence path |
| Does evidence satisfy the hard requirement? | Decision Engine evaluation after V36 state exists |
| Are options materially different under USER preferences? | Decision Engine |
| Does the USER permit Lattice to choose among frontier options? | Intent Authority delegation clarification |
| How should the result be explained or composed? | Solandra presentation |
| Can an external consequential action be performed? | Separate applicable authorization boundary |

Discovery of a gap does not transfer ownership to the discovering subsystem.

## 30. Anti-collapse invariants

The architecture remains correct only while all of these stay true:

1. Conversation != canonical intent.
2. Interpretation != commitment.
3. Inference != USER provenance.
4. USER confirmation != blanket authority.
5. Objective != recommendation.
6. Requirement != preference.
7. `MUST_HAVE` priority != hard requirement.
8. Requirement meaning != requirement satisfaction.
9. Preference strength != evidence strength.
10. Constraint evaluation != USER-authored fact.
11. Intent uncertainty != evidence uncertainty.
12. Model confidence != Product uncertainty authority.
13. USER statement != V36 fact by default.
14. Fact != preference.
15. DecisionPlan != editable intent.
16. Qualified criterion semantics != USER preference.
17. Eligibility != recommendation.
18. Recommendation != mandatory winner.
19. Frontier != presentation ordering.
20. Delegation permission != USER preference.
21. Delegated selection != transaction authorization.
22. StructuredDecision != explanation prose.
23. Solandra emphasis != Decision Engine authority.
24. UI/presentation state != semantic state.
25. Persistence != authority transfer.

## 31. Current implementation alignment

At the reconciliation baseline, current source already demonstrates important parts of this architecture:

- `src/intent/generalized-decision-semantics.ts` represents generalized authoritative USER decision semantics with objective, hard requirements, priority states/tiers, tolerances, and provenance;
- `src/decision/priority-and-requirements.ts` separately defines the four priority tiers and tri-state hard-requirement outcomes, demonstrating that `MUST_HAVE` priority and hard requirements are separate current implementation concepts;
- `src/decision/decision-input-snapshot.ts` resolves already-authoritative intent against exact qualified criterion versions and explicitly does not interpret language, infer priority, admit evidence, or make a decision;
- Intent Authority maintains immutable/versioned IntentVersion lineage and exact downstream binding;
- DecisionPlan durably binds exact IntentVersion planning material to one Run;
- V36 remains the protected external factual truth/evidence authority;
- Decision Engine owns hard-requirement evaluation, eligibility, preference comparison, material-dominance frontier, tie/outcome, delegated selection, and StructuredDecision semantics; and
- Solandra presentation remains reconstructed and subordinate to authoritative Product state.

This document does **not** claim that every semantic distinction described here is exposed as a first-class runtime field, API object, UI affordance, or acceptance probe on current `main`.

Future implementation may still need explicit schema/provenance/basis fields or Product-observable probes to make all anti-collapse invariants mechanically enforceable.

## 32. Validation design

A future implementation/acceptance campaign should prove on one exact candidate revision that:

1. model/interpreter proposals cannot directly commit IntentVersion state;
2. material ambiguity remains pending until valid USER support/confirmation exists;
3. exact proposal-bound confirmation cannot authorize unrelated semantic changes;
4. omission cannot silently remove prior USER meaning;
5. a preference cannot silently become a hard requirement;
6. `MUST_HAVE` priority alone cannot create hard eligibility or a hard requirement;
7. materially ambiguous priority-versus-requirement USER language fails closed to clarification rather than arbitrary classification;
8. a hard requirement cannot be satisfied from missing/UNKNOWN evidence;
9. USER priority cannot strengthen V36 evidence;
10. V36 facts cannot silently become USER preferences;
11. DecisionPlan remains faithful to its exact IntentVersion after later correction;
12. criterion-version drift cannot silently reinterpret a materialized DecisionInput snapshot;
13. ineligible candidates cannot re-enter through preference utility alone;
14. unknown preference coverage is not converted to zero utility;
15. a multi-option material-dominance frontier remains multi-option when no valid selection exists;
16. presentation cannot fabricate a winner from visual ordering or emphasis;
17. delegated selection is impossible without exact valid final-choice delegation;
18. final-choice delegation does not authorize external action;
19. StructuredDecision remains reproducibly attributable to its exact intent/criterion/evidence basis;
20. reconnect reconstruction does not use explanation/presentation state as semantic authority; and
21. a change in presentation alone cannot mutate intent, truth, eligibility, recommendation, or selected-outcome state.

Documentation review does not establish these runtime behaviors. They require exact implementation evidence.

## 33. Implementation guidance

Future Product work should preserve these boundaries using the smallest mechanism that makes them mechanically testable.

Prefer:

- explicit semantic types over overloaded generic value/confidence fields;
- exact provenance and basis identifiers;
- immutable IntentVersion lineage;
- exact DecisionPlan binding;
- qualified criterion-version snapshots;
- separate hard-requirement representation from priority tiers;
- tri-state requirement evaluation;
- separate preference coverage from utility;
- explicit frontier and delegated-selection fields;
- separate intent/evidence/decision uncertainty; and
- reconstructed presentation over duplicate semantic stores.

Avoid universal generic `state`, `confidence`, `score`, `constraint`, `recommendation`, or `selected` fields that erase who owns meaning and how it was established.

The goal is not maximum schema complexity. The goal is preserving the semantic distinctions necessary for trustworthy decisions.

## 34. Structural summary

```text
                         USER
                          |
                          | natural-language meaning
                          v
                    Conversation
                          |
                          | provenance
                          v
                 Interpretation Proposal
                          |
             +------------+-------------+
             |                          |
     non-material / clear        material ambiguity
             |                          |
             |                   clarification /
             |                 exact confirmation
             |                          |
             +------------+-------------+
                          |
                          v
                Lattice Intent Authority
                          |
                          v
                  canonical IntentVersion
             objective / requirements /
           priorities / tolerances /
         conditions / delegation / lineage
                          |
                          v
                    DecisionPlan
                          |
                  exact planning basis
                          |
             +------------+-------------+
             |                          |
             v                          v
      Criterion Catalog            V36 Truth Core
 qualified criterion semantics   admitted evidence
             |                          |
             +------------+-------------+
                          |
                          v
                Lattice Decision Engine
         hard requirements -> eligibility
         priority tiers    -> comparison
         uncertainty       -> explicit limits
         dominance         -> frontier
         delegation        -> optional selection
                          |
                          v
                  StructuredDecision
                          |
                          v
                 Solandra Experience
           faithful explanation / advocacy
                          |
                          v
                         USER
```

The system should therefore be read as:

> **The USER defines the decision through authoritative intent; V36 establishes qualified external evidence; the Decision Engine determines what follows from those inputs; and Solandra helps the USER understand and use that decision state without collapsing the distinctions that made it trustworthy.**

## 35. Draft status and next use

This document is a **RECONCILED DRAFT** against canonical `main @ 8c893bb8b0132b87837a6740709dc1dfff79e44a` and the Owner-directed semantic requirements stated for this Work Item.

It is intended to become the dedicated current architecture reference for the relationship between Lattice Intent Authority and Lattice Decision Engine / StructuredDecision.

It does not independently change protected V36 semantics, qualify new criterion definitions, freeze an in-progress Solandra UI design, authorize new USER-intent inference, claim implementation completeness, transfer validation, or establish production readiness.
