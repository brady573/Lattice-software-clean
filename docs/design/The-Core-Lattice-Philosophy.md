# Status

Owner-adopted 2026-09-28 as highest Product philosophy authority; supersedes the prior Core revision (preserved in git history — do NOT create archive copies, do NOT delete anything else).

## Examples and illustrations

Every concrete example in this document — scenarios, numbers, sample phrasings, thresholds, metric sketches — is ILLUSTRATIVE and NON-NORMATIVE. Examples must never be treated as requirements, test fixtures, acceptance thresholds, implementation rules, or training targets. Normative content is: the vision/stages, product thesis, architecture layers, epistemic states, confidence/action rules, anti-goals, the 21 design principles, and the north star. If an example conflicts with a principle, the principle governs.

# Trustworthy Intelligence for Action
Product Philosophy & High-Level Design
---
1. Vision
Build an intelligence layer that can sit on top of any capable AI model and transform raw machine intelligence into trustworthy, accessible, inspectable, and actionable knowledge.
The product should help a person move through four stages:
Question → Understanding → Confidence → Action
Its purpose is not simply to generate answers faster.
Its purpose is to help people understand:
- what is known,
- what is uncertain,
- what is being inferred,
- what assumptions would otherwise be required,
- what evidence supports a conclusion,
- where credible disagreement exists,
- and what actions are reasonable from the current state of knowledge.
The system succeeds when a user reaches a point where they can say:
"«I understand enough about this situation, including its uncertainty, that I can confidently decide what to do next.»"
---
2. Product Thesis
AI has dramatically reduced the cost of producing answers.
That creates a new problem:
"«Answers are becoming abundant while justified belief remains expensive.»"
A fluent answer can look indistinguishable from a well-supported answer.
The opportunity is therefore not simply another interface for generating more information.
It is an infrastructure layer for transforming machine intelligence into justified understanding.
The product should make it difficult for:
- uncertainty to masquerade as certainty,
- assumptions to masquerade as facts,
- repetition to masquerade as independent evidence,
- and eloquence to masquerade as knowledge.
At the same time, none of this complexity should be imposed on the user.
The long-term product is best understood as:
"«A trust and reasoning layer between humans and machine intelligence.»"
Its job is to continuously answer three questions:
"«What do we know?»"
"«How do we know it?»"
"«What can we responsibly do because of it?»"
---
3. Intelligence Is Not Knowledge
Large language models are extraordinarily useful reasoning systems, but they are not inherently sources of truth.
A model may:
- recall information,
- retrieve information,
- infer relationships,
- identify patterns,
- estimate missing information,
- synthesize evidence,
- or simply generate something statistically plausible.
Those states should never be treated as equivalent.
The application therefore treats an AI model as a reasoning engine rather than an authority.
The model may propose.
The surrounding system must verify, qualify, challenge, contextualize, and determine how strongly the available evidence supports what is being said.
The durable value of the product is not the underlying model.
It is the system surrounding the model.
---
4. Trust Must Be Earned Through Results
The product should not ask users to trust the AI.
It should behave in ways that gradually make trust reasonable.
Trust is behavioral rather than decorative.
The primary mechanisms for building trust should not be:
- badges,
- confidence percentages,
- excessive citations,
- "verified" labels,
- or explanations of how sophisticated the system is.
Instead, users should repeatedly experience that the product:
- gets important details right,
- asks unusually good questions,
- recognizes when information is missing,
- does not bluff,
- corrects itself when better evidence appears,
- distinguishes fact from interpretation,
- surfaces disagreement when it matters,
- and helps the user take useful next steps.
The goal is quiet reliability.
The sophistication of the system should be visible in the quality of its judgment, not in the complexity of its interface.
A central product principle is therefore:
"«Complex reasoning should produce simple clarity.»"
---
5. Never Hide an Assumption
One of the most important responsibilities of the system is preventing models from silently filling gaps.
The system should internally distinguish between several epistemic states.
Known: Supported directly by sufficiently reliable evidence. "«The documentation specifies a maximum operating temperature of 80°C.»"
Inferred: Not stated directly, but reasonably follows from available evidence. "«Given those measurements, the component is probably thermally throttling.»"
Assumed: Something that must be true for the current reasoning to hold but has not been established. "«This conclusion assumes the sensor is calibrated correctly.»"
Unknown: There is currently insufficient evidence to determine the answer. "«We do not yet know whether this failure occurs on earlier firmware versions.»"
Contested: Credible sources or interpretations disagree. "«There are multiple plausible explanations, and the available evidence does not yet distinguish between them.»"
These distinctions should exist throughout the architecture.
They do not need to be constantly displayed to the user.
---
6. The System Should Reduce Uncertainty, Not Merely Produce Answers
Traditional assistants tend to optimize for answering the question immediately.
This product should optimize for:
"«Reducing the uncertainty that prevents the user from understanding or acting.»"
Sometimes the best response is an answer.
Sometimes it is research.
Sometimes it is a test.
Sometimes it is a question.
Sometimes it is identifying that the evidence is not yet sufficient.
The system should recognize which of these moves the user forward most effectively.
---
7. Prefer Questions Over Guesses
When missing information could materially change the conclusion, the system should ask rather than assume.
But it should not interrogate the user unnecessarily.
Every question should have meaningful information value.
A useful question should change:
- what the system believes,
- which explanation is most plausible,
- what evidence should be gathered,
- or what action the user should take.
For example, instead of immediately saying "«Replace the power supply.»" the system may determine: "«Two causes currently fit the symptoms. One observation can distinguish them. Does the computer usually shut down only when the GPU is under heavy load?»"
Questions become a tool for uncertainty reduction rather than a conversational habit.
---
8. Clarify Without Creating Friction
The system should ask the smallest and easiest question capable of resolving the meaningful uncertainty.
It should translate technical requirements into language the user understands.
Instead of: "«What is the transient voltage behavior of the PSU under GPU load?»" ask: "«Does it usually crash when you start a game or another demanding program?»"
The system can translate the user's answer into the technical knowledge it needs internally.
Users should never need to know what information the machine needs in machine terms.
---
9. Confidence Must Be Earned
The model sounding certain is not evidence.
Confidence should emerge from the evidence supporting a claim.
Conceptually: Confidence = Evidence Quality × Evidence Coverage × Agreement × Reasoning Strength
Relevant factors may include: source quality, source independence, primary versus secondary evidence, recency, directness, corroboration, contradictory evidence, unresolved assumptions, and reasoning distance between evidence and conclusion.
The application should generally avoid fake mathematical precision.
Rather than displaying "73% confidence" it may internally classify conclusions using states such as:
Well Established: Multiple strong and sufficiently independent sources directly support the claim.
Supported: Evidence favors the claim, but meaningful limitations remain.
Tentative: A reasonable inference exists, but uncertainty remains significant.
Unresolved: Current evidence cannot reliably distinguish between plausible explanations.
These classifications can shape the system's behavior without necessarily appearing in the interface.
---
10. Confidence Should Shape Language Invisibly
Users should not need to interpret a confidence system.
The system should express epistemic strength naturally.
Strong evidence may produce: "«The failure is caused by the migration.»"
Moderate evidence may produce: "«The migration is the most likely cause.»"
Weaker evidence may produce: "«One plausible cause is the migration.»"
Insufficient evidence may produce: "«There isn't enough information yet to determine the cause.»"
The user experiences calibration through language rather than through a dashboard.
---
11. Evidence Before Eloquence
The internal system should optimize for: "«What evidence allows us to say this?»" rather than: "«How can we make this sound convincing?»"
Important conclusions should ideally be traceable through: Conclusion → Reasoning → Claims → Evidence → Sources
This creates an evidence structure underneath the response rather than relying solely on generated prose.
A polished sentence should never receive more epistemic weight merely because it sounds persuasive.
---
12. Separate Facts From Reasoning
Generated answers frequently combine evidence and interpretation into the same statement.
The system should maintain them separately.
For example:
Evidence: Server logs show memory usage increasing from 4 GB to 15 GB immediately before each crash.
Inference: The crashes correlate with memory exhaustion.
Hypothesis: A memory leak may be causing the exhaustion.
Unknown: The responsible process has not yet been identified.
Next Action: Capture per-process memory usage during the next reproduction.
Separating these concepts prevents speculation from gradually becoming treated as fact.
---
13. Uncertainty Is Useful Information
Most software treats uncertainty as a failure state.
This product should make uncertainty productive.
Instead of ending with "«I don't know.»" the system should attempt to establish:
- What do we not know?
- Why don't we know it?
- Does that missing information matter?
- What would allow us to know it?
- Can we still take a safe action without knowing it?
An unknown therefore becomes a roadmap.
---
14. Contradiction Should Be Preserved
When credible evidence disagrees, the system should resist collapsing that disagreement into one artificial conclusion.
Instead it should preserve and contextualize it.
For example: "«Source A reports one result.»" "«Source B reports another.»" "«The difference appears to come from different populations and measurement periods.»" "«The available evidence does not justify treating either result as universally applicable.»"
This is particularly important in domains such as: science, health, history, policy, emerging technology, markets, rapidly changing events, and other areas where evidence evolves or interpretation matters.
Trust sometimes requires acknowledging that no clean consensus exists.
---
15. Verification Should Happen Before Presentation
The user should benefit from rigorous internal verification without being forced to watch it occur.
Before presenting an important conclusion, the system may internally:
- retrieve multiple sources,
- inspect primary evidence,
- identify assumptions,
- search for contradictions,
- generate competing hypotheses,
- ask a second model to critique the reasoning,
- determine what would falsify the conclusion,
- and estimate whether remaining uncertainty is relevant to the user's decision.
Most of this machinery belongs behind the interface.
The user needs the result, not the internal bureaucracy.
---
16. Expose Complexity Only When It Matters
The default experience should remain simple.
A typical response might contain: What I found (a concise explanation). What matters (the most important facts or interpretation). What to do next (the highest-value next action).
Optional deeper layers can reveal: sources, assumptions, supporting evidence, conflicting evidence, alternative explanations, and reasoning.
This is progressive disclosure applied to trust.
The system should make scrutiny possible without making scrutiny mandatory.
---
17. Show Receipts When Consequences Increase
Evidence visibility should be proportional to the importance and uncertainty of the decision.
For casual questions, the system may remain lightweight.
For consequential claims, disputed information, unfamiliar conclusions, or direct challenges from the user, verification should become immediately accessible.
The architecture should always support inspectability even when the default UX hides most of it.
The principle is: "«Do not force verification on the user, but never prevent it.»"
---
18. The Destination Is Action
Knowledge becomes valuable when it improves what someone can do.
The system should therefore attempt to move beyond explanation toward meaningful action.
Possible next steps may include: making a decision, running a test, collecting information, comparing alternatives, contacting someone, mitigating a risk, verifying a critical claim, delaying a decision, escalating to an expert, or intentionally doing nothing.
An actionable recommendation may internally contain: Action (what can be done). Reason (why the evidence supports doing it). Expected Outcome (what should happen if the current understanding is correct). Risk (what could go wrong). Reversibility (how difficult the action is to undo). Verification (how the user can tell whether it worked).
The UX does not necessarily need to expose every field.
---
19. Prefer Reversible Actions Under Uncertainty
Uncertainty should influence behavior.
When confidence is weak, the system should favor actions that are: reversible, inexpensive, low risk, diagnostic, and information producing.
As evidence strengthens, more consequential actions may become reasonable.
Conceptually: Low confidence → investigate. Moderate confidence → test. High confidence → act.
The exact thresholds should depend on the consequences.
A low-risk action may tolerate more uncertainty than an irreversible, expensive, dangerous, or high-impact action.
---
20. Preserve Human Agency
The system should improve judgment rather than replace it.
The AI's role is to: organize complexity, surface evidence, identify uncertainty, expose assumptions, reveal tradeoffs, discover missing information, reason about consequences, and suggest possible actions.
The user's role is to: provide context, determine goals, establish values, choose acceptable risk, and ultimately decide.
The system should make users more capable, not more dependent.
---
21. Universal Access Is a Core Requirement
Sophisticated reasoning is only valuable if people can actually use it.
A central design principle should therefore be: "«The intelligence belongs in the system, not in the requirements placed on the user.»"
A person should not need to understand: AI, prompt engineering, statistics, research methodology, formal logic, or technical terminology to receive the benefits of the system.
The application should adapt to the user rather than requiring the user to adapt to it.
---
22. Simple by Default
The default interaction should be understandable to someone with no technical background.
The product should favor: plain language, clear structure, short explanations, familiar terminology, obvious next steps, and progressive disclosure.
Complexity should appear only when it improves understanding or decision quality.
Simple should not mean shallow.
---
23. Accessible Does Not Mean Simplistic
Simplifying an explanation must not mean removing important uncertainty or distorting the truth.
The objective is: "«Make the idea easier to understand without making the idea less accurate.»"
The same evidence may be explained differently depending on the user.
The underlying truth conditions should not change.
---
24. Meet Users at Their Level
The system should adapt explanation depth to the person and context.
The same knowledge could be presented differently for: a beginner, a child, a domain expert, someone learning, someone under time pressure, or someone making a consequential decision.
The evidence remains the same.
The interface and explanation adapt.
Users should also be able to request: a simpler explanation, greater technical detail, examples, visual explanation, step-by-step guidance, or only the conclusion.
---
25. Never Require Prompt Engineering
The user should not need to learn how to operate the model.
A vague input such as "«My computer keeps crashing.»" should be enough to start a productive investigation.
The system should help structure incomplete problems internally.
It should infer likely intent where safe, ask for clarification when necessary, and progressively build a useful representation of the problem.
The quality of the result should not depend on whether the user knows how to write an ideal prompt.
---
26. Multiple Ways to Communicate
People should be able to communicate with the system through whatever form is easiest for them.
The product should eventually support combinations of: text, voice, images, screenshots, documents, structured data, video, sensor data, application integrations, and external knowledge systems.
A user should be able to show the system a problem when explaining it is difficult.
---
27. Physical and Digital Accessibility
Accessibility should be built into the design system rather than added later.
The product should support: screen readers, full keyboard navigation, scalable text, clear focus states, high contrast, reduced motion, captions, transcripts, semantic structure, predictable navigation, and meaning that does not depend solely on color.
Accessibility requirements should exist at the component and platform level.
---
28. Language Should Not Be a Barrier
Users should be able to communicate in their natural language.
Translation and localization should preserve: meaning, evidence strength, uncertainty, technical precision, and culturally relevant context.
Localization should never accidentally transform a tentative conclusion into a certain one or weaken an established fact.
---
29. Cognitive Accessibility
The system should reduce cognitive load.
It should not display everything it knows simply because the information exists.
Default responses should emphasize:
1. What matters.
2. What the user needs to understand.
3. What they can do next.
Supporting detail remains available without competing for attention.
The system should absorb complexity on behalf of the user.
---
30. Preserve User Dignity
The product should never make someone feel incapable because they lack domain knowledge.
A poorly phrased question should still receive a high-quality response.
The system should quietly translate between: the user's mental model and the underlying technical or domain model.
Users should feel more capable after interacting with the system than they did before.
---
31. High-Level Architecture
The product should remain model-agnostic.
The underlying AI model is one replaceable component within a larger reasoning system.
User → Intent & Context → Problem Decomposition → Epistemic State (Evidence / Assumptions / Contradictions) → Reasoning Layer → Synthesis → Action Engine → User Experience
---
32. User Intent Layer
The first responsibility is understanding what the user is actually trying to accomplish.
Not simply: "«What question did they type?»" but: "«What understanding, decision, or action are they ultimately trying to reach?»"
The system should distinguish between surface requests and underlying goals.
This enables it to provide information relevant to the user's actual objective rather than merely satisfying the literal wording of the prompt.
---
33. Problem Decomposition Layer
Complex questions should be decomposed into: claims, subquestions, required facts, assumptions, dependencies, decision criteria, and unknowns.
This creates a structured reasoning problem before a final response is generated.
The system should reason over that structure rather than relying solely on a single conversational completion.
---
34. Epistemic State
The core internal representation should describe what the system currently knows and why.
Conceptually: Claim ├── statement ├── status (known / inferred / assumed / unknown / contested) ├── evidence[] ├── sources[] ├── contradictions[] ├── dependencies[] ├── confidence └── last_verified. This state should evolve as new evidence arrives. It becomes the system's working representation of justified knowledge.
---
35. Evidence Layer
The evidence layer acquires information necessary to support or challenge claims.
Potential sources include: primary documentation, web sources, academic research, databases, APIs, organizational knowledge, uploaded files, user-provided information, application data, system logs, sensors, and previously validated evidence.
Evidence should carry metadata such as: origin, timestamp, author, source type, directness, reliability characteristics, and relationship to other sources.
---
36. Source Evaluation Layer
Retrieval does not equal verification.
The system must evaluate evidence in context.
It should ask: Is this a primary source? Is this source authoritative for this claim? Is the information current? Does it cite underlying evidence? Are multiple sources actually repeating the same origin? Does a credible source contradict it? Does the source have direct knowledge of the event or fact?
Source quality is contextual.
A forum post may be weak evidence for scientific efficacy while being strong evidence that users are encountering a particular software bug.
---
37. Assumption Guard
The assumption guard is one of the most important architectural components.
Before allowing an important conclusion to stand, it asks: "«What must be true for this reasoning to hold?»"
Any unsupported dependency becomes: an assumption, an unknown, a research target, or a question for the user.
The system may then: retrieve additional evidence, ask a clarifying question, weaken the conclusion, generate alternative hypotheses, or block the conclusion entirely.
This directly addresses the tendency of generative models to silently fill missing information.
---
38. Contradiction Engine
The system should actively attempt to challenge its own conclusions.
For important claims, it may ask: "«What evidence would make this conclusion wrong?»" "«What alternative explanation fits the same evidence?»" "«Which assumptions are most fragile?»" "«Are any sources contradicting this conclusion?»" "«Are apparently independent sources actually dependent on one original claim?»"
The goal is not skepticism for its own sake.
The goal is resilience against premature certainty.
---
39. Model Orchestration
The product should avoid becoming dependent on the personality or behavior of one model.
Trust & Reasoning System → Model Orchestrator (Model A / Model B / Model C / Local Model / Future Models).
Different models may eventually serve different roles: planner, researcher, verifier, critic, synthesizer, question generator, or action planner.
Models should be replaceable.
The durable product value is the machinery governing evidence, reasoning, uncertainty, and action.
---
40. Synthesis Engine
After evidence has been gathered and evaluated, the synthesis engine converts the current epistemic state into a coherent explanation.
It should remain constrained by the evidence structure.
It should not introduce unsupported claims merely because they produce a cleaner narrative.
The quality of prose is subordinate to the integrity of the reasoning.
---
41. Action Engine
The action engine determines what the user can reasonably do given the current state of knowledge.
It considers: the user's goal, evidence strength, unresolved uncertainty, consequences, risk, reversibility, cost, and the information value of potential next steps.
The best next move might be: act, investigate, verify, test, ask, compare, escalate, or wait.
---
42. The Confidence-to-Action Loop
The core interaction model is a loop rather than a single response.
User Goal → What must we know? → Gather Evidence → Identify Unknowns and Assumptions → Enough to act? (No → Ask/Research/Test/Verify → New Evidence; Yes → Recommend Action) → Outcome → Learn.
The conversation becomes a process of progressive uncertainty reduction.
---
43. Example Experience
Suppose the user asks: "«Why is my deployment failing?»"
The system should not begin by exposing an evidence graph, confidence matrix, and reasoning trace.
It might say: "«The deployment itself is succeeding. The failure occurs during the database migration. Your logs show the migration trying to add a column that already exists.»" Then: "«Next step: Check whether migration "0184" is already recorded in the production migrations table before rerunning it.»" Potentially followed by lightweight controls: "«Sources · Why I think this · Other possibilities»"
Behind that answer, the system may have: examined logs, inspected configuration, generated several hypotheses, rejected unsupported possibilities, validated migration behavior, identified an assumption, and compared competing explanations.
The user does not need to see that machinery.
They experience its value through the precision of the answer.
---
44. Distance to Confident Action
A central product metric should be: "«How much meaningful uncertainty remains between the user's current state and an informed action?»" Call this Distance to Confident Action.
A useful interaction reduces that distance.
It may do so by: providing evidence, correcting misinformation, asking a high-value question, identifying an assumption, resolving disagreement, performing research, running an analysis, or proposing a safe experiment.
The system does not need to produce a definitive answer every time.
It needs to reliably move the user closer to justified action.
---
45. Measuring Trust Through Outcomes
Trust itself should not be optimized as a superficial engagement metric.
Instead, measure behaviors that indicate justified reliability.
Potential signals include: rate of unsupported claims caught before presentation, rate of material assumptions surfaced internally, frequency of conclusions revised after new evidence, quality of next-action recommendations, successful resolution rate, user correction rate, source traceability, action success rate, number of unnecessary clarifying questions, and reduction in time or steps required to reach a sound decision.
The product should optimize for being trustworthy rather than looking trustworthy.
---
46. Anti-Goals
The product should explicitly avoid becoming several things.
An Answer Machine: Producing an answer is not the same as resolving a problem.
A Citation Decorator: Adding links to generated prose does not automatically make the reasoning trustworthy.
A Confidence Theater System: A numerical score beside an unsupported claim does not create meaningful confidence.
A Consensus Machine: Disagreement should not be averaged into artificial certainty.
A Prompt Engineering Tool: Users should not be required to learn how to communicate with models correctly.
An Autonomous Decision Maker: The goal is to strengthen human judgment rather than replace it.
A Complexity Showcase: The system should not expose internal machinery simply to demonstrate sophistication.
A Perfect Truth Machine: Perfect certainty will often be impossible. The system should instead make uncertainty explicit, useful, and manageable.
---
47. Core Design Principles
Every important feature should be evaluated against these principles:
1. Never silently assume.
2. Distinguish evidence from inference.
3. Treat models as reasoning engines, not authorities.
4. Prefer primary evidence where practical.
5. Preserve meaningful disagreement.
6. Ask questions only when their answers materially matter.
7. Match confidence to evidence.
8. Match language to confidence.
9. Match action severity to confidence.
10. Prefer reversible actions when uncertainty is high.
11. Make reasoning inspectable without making inspection mandatory.
12. Verify before presenting when the consequences justify it.
13. Hide machinery unless it improves the user's experience.
14. Never require prompt engineering.
15. Adapt explanations to the user without changing the underlying truth.
16. Design for accessibility from the beginning.
17. Reduce cognitive load rather than exposing internal complexity.
18. Preserve user dignity.
19. Optimize for human agency rather than dependence.
20. Measure progress by distance to meaningful action.
21. Earn trust through consistent outcomes rather than trust signals.
---
48. The North Star
The product should feel simple even when the problem is not.
A person should be able to arrive with: an incomplete question, little domain knowledge, uncertain terminology, limited technical ability, accessibility needs, or only a vague sense of the problem.
The system absorbs the complexity.
It determines what matters.
It finds what is missing.
It validates what can be validated.
It exposes uncertainty when it matters.
It asks for help only when necessary.
It explains the result in terms the person can understand.
And it helps them move forward.
The north-star principle is: "«Make trustworthy intelligence usable by anyone.»"
And the operating philosophy beneath it is: "«The intelligence belongs in the system, the decision belongs to the user, and trust is earned by the quality of what happens in between.»"
