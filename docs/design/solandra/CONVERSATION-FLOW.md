# Solandra Conversation Flow and Composer Contract

Status: **OWNER-APPROVED PRODUCT UI DESIGN — CONTINUOUS INTERACTION**  
Approval basis: Owner review on 2026-08-31 plus the later Owner correction retiring the fixed presentation-phase and global presentation-gate model.  
Scope: how Conversation, clarification, information gathering, Product-state changes, and Composer presentation evolve naturally from request through understanding, decision support, and action support.

`PRIMARY-INTERACTION-CONTRACT.md` controls interaction conflicts. `../Lattice-Intent-and-Decision-Architecture.md` controls the semantic distinctions between USER meaning, evidence, decision state, recommendation, selection, confirmation, and uncertainty.

## 1. Mental model

The person is talking with Solandra. Solandra is responsible for helping the person understand, decide, or act. The Composer is the shared visual surface she uses to support that conversation.

The person should not need to understand a workflow model, operate presentation states, or guess what command will make Solandra useful.

Conversation is continuous. Solandra may clarify, research, explain, compare, recommend, correct, prepare resources, or help the person act whenever the exact Product state licenses that behavior and it is useful now.

## 2. Continuous conversation

Ordinary interaction does not advance through a fixed user-facing presentation sequence.

The same Conversation continues while the underlying Product state evolves. The Composer changes what it shows because the most useful trustworthy information changes.

Clarification, research, evidence gathering, comparison, recommendation, challenge, action preparation, resource use, and inspection are ordinary activities inside the conversation. They do not require dedicated navigation states or a global display gate.

Solandra should remain responsive to what the person needs now rather than forcing the interaction to complete one presentation category before another can appear.

## 3. Understanding and clarification

Solandra continuously reasons about what the person is actually trying to accomplish while preserving the difference between **accepted USER meaning** and **pending interpretation**.

The conversation may add or revise:

- the outcome the person wants;
- hard boundaries;
- preferences and trade-offs;
- relevant people, objects, times, conditions, or dependencies;
- important unknowns;
- external facts that could materially change what information should be provided.

Accepted meaning comes from Intent Authority. A model, parser, or Solandra may propose meaning, but a materially pending proposal remains pending until resolved under Intent Authority semantics.

The Composer may show a concise visual representation of accepted meaning when that helps the person recognize, correct, compare, or act on it. It may also show a pending interpretation when seeing that proposal materially improves the conversation, but its tentative status must remain clear.

Understanding is therefore a continuously available semantic basis and Composer content pattern, not a user-facing stage that must remain active until a separate transition condition is satisfied.

## 4. Information gathering

Solandra is not limited to extracting facts already present in the person's request.

She may need the Product to gather information the person did not know to ask for.

Examples of decision-changing gaps include:

- a current external fact needed to evaluate an exact USER requirement;
- an eligibility rule the person did not know was relevant;
- a dependency that changes whether a proposed path is viable;
- a timing or safety constraint;
- evidence that distinguishes otherwise plausible alternatives.

The governing rule is not “collect everything.” It is:

**Gather what could materially improve the usefulness, accuracy, or actionability of what Solandra can responsibly provide.**

The semantic owner still matters:

- unresolved USER meaning routes to Intent Authority clarification/confirmation;
- unresolved external facts route through the V36 evidence/research path;
- unresolved decision support routes through Decision Engine semantics once exact intent and evidence exist.

Discovery of a gap does not transfer authority to Solandra.

Information gathering may happen before, during, or after other useful content is shown. Internal work-in-progress does not by itself require a separate Composer state, and already-supported useful content does not need to be withheld merely because other work remains incomplete.

## 5. Content licensing

There is no single global threshold that turns the interface from “understanding” into “knowledge.”

Each material piece of content is independently constrained by the Product authority that owns its meaning:

- accepted USER meaning must be supported by Intent Authority;
- external factual claims must be supported by V36-admitted evidence;
- eligibility, comparison, recommendation/frontier state, and selected outcomes must be supported by Decision Engine state;
- consequential action remains separately authorized and executed through the applicable action/runtime boundary;
- presentation may organize, explain, emphasize, or combine licensed material without strengthening it.

Solandra may therefore do several useful things at once. She can clarify one unresolved point while showing an already-supported Resource, explain a supported finding while another fact is still being researched, or present a decision frontier while separately identifying an evidence gap that prevents a stronger conclusion.

A supported limitation may itself be useful content when it materially helps the person understand, decide, or act.

## 6. Useful knowledge and decision support

When Product state supports useful information, Solandra should present it without requiring the person to unlock a special operation.

That information may include:

- explanation supportable from accepted meaning;
- V36-supported factual findings;
- comparison licensed by exact intent, criterion semantics, and admitted evidence;
- one or more recommendation/frontier options from StructuredDecision;
- important facts the person did not know to ask about;
- evidence or decision uncertainty and caution;
- a plan;
- a map, link, contact, document, image, video, checklist, or generated artifact;
- concrete guidance for the next decision or action.

The Composer should replace or reorganize less-useful material as the conversation changes. Accepted understanding may remain visible when it materially helps interpret the current information, but it is not permanent chrome and must not crowd out more useful content.

Recommendation and action support are ordinary Product outputs, not separate presentation stages.

## 7. Recommendation shape is not always a winner

Decision presentation must preserve the actual StructuredDecision shape.

The Product may support:

- one clearly dominant option;
- several materially distinct frontier options;
- a tie or unresolved outcome;
- no safely recommendable option;
- a selected outcome only when valid decision state and authorization support selection.

Solandra may make a multi-option frontier understandable, but she must not collapse it into a fabricated winner for presentation convenience.

## 8. No-riddle rule

The person must not have to discover phrases such as:

- `compare these`;
- `research this`;
- `recommend one`;
- `continue`;
- `what next`.

Those are valid conversational requests, but they are not hidden keys that unlock Product capability or presentation.

When useful content is available and licensed, Solandra should surface it naturally. When a material uncertainty prevents a stronger answer, Solandra should explain or clarify that directly rather than making the person discover a command.

## 9. Confirmation behavior

A conversational confirmation such as `yes` has semantic effect only when it unambiguously binds the exact fresh proposition required by Intent Authority.

The UI may show a broad understanding summary for comprehension, but that summary must not silently turn a generic affirmative response into confirmation of several materially independent interpretations.

When material propositions require independent resolution, Solandra should make the exact proposition being confirmed clear in Conversation or Composer without turning the experience into a form.

Confirmation of USER meaning does not confirm external facts, recommendation correctness, final-choice delegation, or action authorization unless that exact proposition is separately and validly established.

## 10. Uncertainty routing

The conversation should route uncertainty to its semantic owner rather than treating every unknown as a reason to ask the USER another question.

- **Intent uncertainty:** what does the USER mean? → clarify/confirm through Intent Authority.
- **Evidence uncertainty:** what is true about the world? → V36 evidence/research path or explicit factual limitation.
- **Decision uncertainty:** what outcome is supportable from exact intent and admitted evidence? → Decision Engine state and faithful explanation.

The Composer may simplify the wording, but the underlying distinction must remain preserved.

## 11. Reversibility

Useful information does not freeze the person's request or the Product basis.

If the person materially changes the request:

1. Intent Authority establishes the revised accepted meaning under its own contract;
2. stale Composer content that depended on the old basis is retired or recomputed;
3. newly relevant evidence or decision work proceeds as required; and
4. Solandra continues presenting whatever information remains useful and valid on the current basis.

Historical IntentVersion, DecisionPlan, V36, and StructuredDecision state are not rewritten merely because the current conversation changes.

## 12. Conversation input

The text-entry/send control is the **conversation input**, not the Composer.

Required mechanics:

- free-form text throughout ordinary interaction;
- Enter sends only when IME composition is inactive;
- Shift+Enter inserts a newline;
- bounded textarea growth;
- one unresolved logical turn at a time unless a future qualified design changes that rule;
- duplicate Send disabled while that turn is pending;
- no silent queueing or auto-send of later draft text;
- failure preserves transcript, draft, and trustworthy Composer state;
- async response does not reopen the mobile keyboard.

Input hints may be neutral. They must never encode a hidden command required for useful Product behavior.

## 13. Interaction inspection fixtures

Executable UI fixtures should test interaction consequences without teaching the Product a fixed sequence or domain schema.

Useful fixture cases include:

### Clarification with useful existing context
The person gives an ambiguous request. Solandra asks the exact material clarification while the Composer continues showing any already-valid useful context rather than switching to an empty waiting screen.

### New evidence while the conversation continues
A V36-supported fact becomes available during the conversation. The Composer may surface that fact immediately when useful without waiting for unrelated unresolved work to finish.

### Decision frontier
StructuredDecision contains multiple materially distinct frontier options. Conversation explains the trade-off and the Composer preserves the multi-option state rather than manufacturing one winner.

### Material correction
The person changes a requirement or preference. The Product updates the authoritative intent basis; stale dependent Composer material is retired or recomputed while unaffected useful material may remain.

### Resource takeover
A substantial Resource becomes the most useful visual content. It takes over the Composer while Conversation and ConversationInput remain available, and a quiet return action restores the prior composition.

These fixtures are examples for observable behavior only. Their order, turn count, topic, or nouns must not become Product schema.

## 14. Acceptance questions

A conforming design must answer yes to all of these:

1. Can the person start naturally without learning the UI?
2. Can Solandra clarify material USER meaning without forcing the interaction into a workflow stepper or presentation stage?
3. Can accepted USER meaning and material pending interpretation remain distinguishable whenever both are shown?
4. Can the Composer show the most useful currently licensed information even while other clarification, research, or decision work remains unresolved?
5. Does each factual, decision, recommendation, selection, and action-related presentation remain faithful to its owning Product authority?
6. Does useful content appear naturally when available without requiring a trigger phrase or hidden command?
7. Can data gathering include information the person did not know to ask for when it materially improves usefulness, accuracy, or actionability?
8. Can a material correction invalidate stale dependent content without rewriting historical Product state?
9. Does recommendation presentation preserve frontier/winner semantics from StructuredDecision?
10. Does uncertainty route to the correct semantic owner rather than one generic confidence state?
11. Does the interface avoid a fixed user-facing presentation-phase taxonomy or global content-readiness gate?
12. Do Conversation, ConversationInput, and Composer remain the stable primary interaction frame throughout the flow?
