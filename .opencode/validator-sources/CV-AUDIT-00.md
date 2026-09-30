# CV-AUDIT-00 — Deep Code Audit Procedure

## Purpose

Provide a repeatable, evidence-driven procedure for broad Lattice implementation audits.

This source deepens `CV-00` for substantial `BASELINE_REVIEW` work. It does not replace `CV-01`, `CV-02`, `CV-03`, `CV-04`, the shared authority/evidence sources, or `CV-TRACE-00`. It orchestrates them.

The governing question is:

> For the exact candidate and declared audit scope, what material correctness, reliability, security, compatibility, persistence, concurrency, dependency, integration, or validation defects can be established from independent evidence, and what bounded remediation would remove or contain them?

A deep audit is not proof of defect absence and is not a Product-readiness, merge, release, deployment, or production authorization.

## Invocation

Use this procedure when the user asks for a deep audit, general code audit, comprehensive code validation, broad baseline review, security/reliability audit of the implementation, or a re-audit after major remediation, architecture transition, incident, or accumulated change.

Typical invocation:

`Run CV-AUDIT-00 on <repo/ref/SHA>.`

If the request is narrower, use `DIFF_REVIEW` or `TARGETED_INVESTIGATION` under `CV-00` instead of expanding into a deep audit.

## Governing sources

Always load and apply `LAT-SHARED-00`, `LAT-SHARED-01`, `CV-00`, and `CV-AUDIT-00`.

Then load only the material specialist modules: `CV-01` for correctness, reliability, state, lifecycle, persistence, concurrency, regression, performance, and tests; `CV-02` for security, authentication/authorization, dependencies, vulnerabilities, supply chain, secrets, and trust boundaries; `CV-03` for external semantics, standards, upstream behavior, advisories, compatibility, and independent challenge; `CV-04` for findings, severity, confidence, remediation, verification, and handoff; and `CV-TRACE-00` when trace output is requested.

Repository documents may establish candidate state or local design intent. They do not become Product authority or independent proof merely because multiple repository artifacts agree.

## Audit invariants

1. Freeze candidate identity before substantive inspection.
2. Establish intended behavior from applicable Owner/Core/Steward authority before using implementation behavior as an oracle.
3. Keep Product authority, candidate reality, external technical reality, and execution evidence separate.
4. Never let repository evidence independently prove a repository-originating external claim.
5. Do not treat green CI, passing tests, scanners, architecture docs, comments, or prior reports as self-certification.
6. Preserve `KNOWN`, `CLAIMED`, `INFERRED`, `UNKNOWN`, and `DECISIVE_UNKNOWN`.
7. Severity measures consequence; confidence measures evidentiary strength.
8. Prefer the smallest safe remediation supported by evidence.
9. Explain every material red signal. Do not silently dismiss failing tests, CI jobs, scanner findings, or contradictory runtime evidence.
10. Revalidate after material changes to code, dependency state, environment, external semantics, evaluator/tooling, or governing requirements.
11. Report only within the evidence actually inspected.
12. A deep audit may conclude `NO_MATERIAL_FINDINGS`, `FINDINGS_PRESENT`, `BLOCKED`, or `UNKNOWN` only.

# Phase 1 — Freeze the audit subject

Before reviewing implementation behavior, record the candidate identity.

| Field | Required evidence |
| --- | --- |
| Repository | Canonical repository or explicitly designated alternative |
| Ref | Branch, tag, PR, commit, worktree, or supplied candidate |
| Immutable revision | SHA/tree or equivalent when available |
| Working state | Clean/dirty/uncommitted state when relevant |
| Dependency state | Lockfile/resolved dependency identity |
| Runtime/build environment | Language/runtime/compiler/OS/database/browser/service versions that materially affect behavior |
| Audit mode | Normally `BASELINE_REVIEW` |
| Requested scope | Systems, components, concerns, and exclusions |
| Governing authority | Applicable Owner/Core/Steward source/revision |
| Audit date | Date of inspection |
| External evidence date | Date/version where technical semantics can change |

If the exact candidate cannot be established and that uncertainty could change findings, mark the candidate identity `DECISIVE_UNKNOWN` and use `UNKNOWN` or `BLOCKED` as appropriate.

Do not silently move to a newer branch head during the audit. A changed head is a changed candidate.

# Phase 2 — Establish intended behavior

Build the requirement/invariant basis before judging implementation.

For each material subsystem, identify the Product or technical behavior that is required, the authority establishing that behavior, implementation constraints explicitly imposed by that authority, trust boundaries that must remain separated, failure behavior that must fail closed or fail visibly, durable continuity/recovery requirements, authorization requirements, evidence/provenance requirements, and compatibility requirements that are actually in scope.

Do not infer a Product requirement merely because tests, code, architecture documents, or historical behavior expect it.

When authority is silent on a purely technical implementation detail, distinguish the technical requirement from Product intent. External technical documentation can establish feasibility or semantics without redefining Lattice Product intent.

# Phase 3 — Build the audit map

Before deep inspection, map the candidate so the audit is risk-directed rather than file-count-directed.

The audit map should identify runtime entry points, public API and UI entry points, authentication and subject-resolution boundaries, authorization and capability boundaries, trust transitions, major state machines, persistence stores and migrations, queues/workers/schedulers/retries/leases/outboxes/asynchronous handoffs, external services/model providers/network calls/web acquisition/protocol boundaries, configuration and feature-mode switches, browser/client persistence and recovery state, artifact/build/deployment surfaces, material dependencies/runtime versions, and tests/CI lanes/validators/proof harnesses that claim coverage.

For each mapped area assign an **audit-attention level** of HIGH, MEDIUM, or LOW. Audit-attention level is not defect severity.

HIGH attention is appropriate when failure could cross an authorization, privacy, subject-isolation, truth, execution, or destructive-action boundary; shared mutable or durable state is modified concurrently; retries/cancellation/leases/epochs/idempotency/restart recovery are involved; external or vendor semantics materially control correctness; malformed or untrusted input reaches privileged behavior; the subsystem has recent defect/change history; CI/runtime evidence is contradictory, flaky, stale, or missing; or the subsystem can corrupt durable state or silently misrepresent authority/provenance.

The audit must inspect every HIGH-attention boundary or explicitly record why it could not be inspected.

# Phase 4 — Minimum Lattice audit matrix

A general Lattice deep audit should address the following lanes unless explicitly out of scope.

| Audit lane | Minimum inspection |
| --- | --- |
| Runtime composition | Startup ordering, required services, lifecycle ownership, shutdown, configuration validation, fail-closed startup |
| Authentication and subject isolation | Credential handling, authenticated subject construction, route coverage, tenant/user ownership, cross-subject reads/writes |
| Intent and provenance | USER source identity, correction/successor state, replay/idempotency, non-authoritative model interpretation boundaries |
| Knowledge/truth boundaries | Acquisition, source identity, evidence admission, provenance, uncertainty, stale/current semantics, presentation fidelity |
| Decision/authorization separation | Decision output, user choice, capability grants, action preparation, explicit authorization, execution and verification separation |
| Persistence and migrations | Schema readiness, migration ordering, transactional integrity, rollback, restart reconstruction, backward/forward compatibility |
| Concurrency and async work | CAS/version checks, leases, stale workers, duplicate delivery, cancellation, retry safety, race windows, outbox behavior |
| External integrations | Model/provider APIs, HTTP behavior, redirects, timeouts, size limits, credentials, SSRF controls, schema validation, upstream semantics |
| Browser/UI boundary | Output encoding, user-input routing, recovery state, stale client state, confirmation/correction handling, browser storage, authoritative server/client division |
| Dependencies and supply chain | Effective locked versions, advisories, reachability, supported runtimes, build provenance, pinned CI actions where material |
| Validation machinery | CI lane applicability, skipped tests, stale fixtures, evaluator drift, exact-SHA binding, false-green and false-red conditions |
| Observability and failure disclosure | Logs, errors, secret leakage, swallowed failures, ambiguous success, operational evidence |
| Performance/resource correctness | Only when material: unbounded memory/input, blocking work, starvation, queue growth, timeout/lease mismatch, load-sensitive races |

An audit does not have to inspect every file in each lane. It must inspect enough direct implementation evidence to justify the lane conclusion and record meaningful exclusions.

# Phase 5 — Structural implementation inspection

For every HIGH-attention subsystem and any MEDIUM-attention subsystem materially implicated by evidence, perform structural inspection.

## Control flow

Trace the normal path and the important abnormal paths: validation rejection, authentication failure, authorization denial/revocation, provider/network failure, timeout, cancellation, retry, duplicate request, stale version, restart, partial completion, and cleanup/shutdown.

Look for checks that occur too early and are invalid by the time their result is used, checks that happen after irreversible effects, and error branches that leave partial state.

## Data flow

Trace material data from origin to sink.

For each sensitive or authority-bearing value identify origin, validation/canonicalization, transformations, scope/ownership binding, persistence, transmission, rehydration, consumer, and invalidation/supersession.

Pay special attention to IDs, subject identity, intent versions, run versions, capability versions, authorization state, provenance, source URIs, model output, prepared actions, external content, secrets, and user-controlled text.

## State and successor-state behavior

Inspect initialization, legal transitions, invalid transitions, stale predecessor state, correction, supersession, idempotent replay, duplicate delivery, cancellation, rollback, restart/reconstruction, deletion/revocation, and post-failure continuity.

A correction should create or select the correct successor state rather than silently rewriting the evidentiary meaning of prior state unless the governing design explicitly requires mutation.

## Concurrency

For each read-check-write sequence ask whether the checked condition can change before the dependent write or result release.

Identify compare-and-set/version predicates, transaction boundaries, locking assumptions, leases and lease expiry, stale completion/failure paths, concurrent duplicate work, reentrancy, cross-process visibility, and retry after partial side effect.

Do not assume serial behavior because tests normally run serially.

## Lifecycle ownership

Verify acquisition and cleanup of database pools/connections, sockets, server listeners, browser/process children, timers, subscriptions, workers, file handles, and external requests.

Test or inspect failure during partial initialization so earlier resources are still closed.

# Phase 6 — Security and trust-boundary inspection

Treat security as a set of concrete trust-boundary questions, not a generic scanner pass.

For every externally reachable or privilege-bearing path establish: who the subject is; how identity is authenticated; what resource/action is requested; what binds it to the subject; what authorization state is required at the point of effect; whether authorization can change while work is in flight; what untrusted data crosses the boundary; where it is parsed/validated/canonicalized/encoded; what secret or sensitive material is visible; what durable/external side effect can occur; what evidence is recorded; and what happens after revocation, deletion, timeout, failure, or retry.

Inspect materially relevant classes of weakness from `CV-02`, including injection, SSRF, unsafe URL handling, output encoding/XSS, path handling, deserialization, error leakage, insecure defaults, secret exposure, cross-subject access, privilege confusion, and supply-chain exposure.

Do not label a dependency vulnerability exploitable until package affectedness, reachable path, exploit conditions, and relevant mitigations are distinguished.

# Phase 7 — External Challenge Pass

The deep audit must contain an explicit External Challenge Pass.

Create an **assumption register** for material implementation assumptions whose truth may lie outside the repository.

| Field | Meaning |
| --- | --- |
| Assumption | The technical proposition the candidate relies on |
| Class | LOCAL / EXTERNAL / MIXED |
| Consequence if false | What finding or remediation could change |
| Candidate version/environment | Exact applicability context |
| Independent source | Normative/primary source whenever available |
| Source result | What is established |
| Caveat | Limits, conflict, version mismatch, or unresolved question |
| Claim state | KNOWN / INFERRED / UNKNOWN / DECISIVE_UNKNOWN |

Mandatory external verification includes material dependence on language/compiler/runtime behavior, framework lifecycle semantics, database isolation/locking/transaction semantics, browser behavior, HTTP/protocol semantics, vendor/model/provider API behavior, cloud/platform behavior, cryptographic/security guidance, dependency advisories, supported-version/compatibility claims, and packaging/build/provenance semantics.

Search independently of the repository's preferred conclusion. Look for caveats, exceptions, advisories, errata, and version-specific changes.

Do not send private code, secrets, proprietary identifiers, internal hostnames, customer data, or confidential incident details to external search systems. Sanitize the technical question.

# Phase 8 — Execution evidence plan

After structural inspection, choose execution evidence based on the risks discovered. Do not mechanically run every available tool.

Potential evidence includes build/typecheck/lint, focused unit/integration tests, real-storage integration, exact-SHA CI jobs, static analysis or CodeQL, dependency/advisory checks, targeted runtime reproduction, failure injection, restart/recovery testing, concurrency/race orchestration, browser automation, fuzzing/property-based testing, sanitizer/runtime diagnostics, benchmark/load testing when performance is correctness-relevant, and external conformance checks.

For each execution result record the exact candidate revision, command/workflow/job, environment, tool/runtime version when material, result, skipped/disabled coverage, what the result establishes, and what it does not establish.

A passing test is useful only if it exercises the relevant failure mode. A failing test must be explained, not merely counted.

# Phase 9 — Evaluator and test-integrity challenge

A deep audit must audit the audit machinery when it materially contributes to confidence.

For important tests or validators ask whether the fixture reflects the current implementation contract; whether the test exercises the canonical path; whether it tests behavior or implementation trivia; whether code and test encode the same false assumption; whether it binds to the exact inspected SHA; whether material tests are skipped; whether mocks hide provider/database/browser semantics; whether a stale harness can produce a false failure; whether a permissive fixture can produce a false pass; and whether the assertion verifies the trust property rather than merely the presence of machinery.

When CI lanes disagree, identify the actual failed step and determine whether it establishes a candidate defect, evaluator defect, environment defect, or unresolved signal.

# Phase 10 — Adversarial and held-out challenge

Before synthesizing findings, deliberately challenge the candidate with scenarios not merely copied from existing tests.

Select scenarios based on the audit map. High-value challenges include wrong-subject access, revocation while work is in flight, disconnect/reconnect across an old completion, duplicate delivery, stale worker completion, retry after an external side effect, restart between state transitions, stale browser/client state, malformed or oversized external response, redirects or unexpected URL forms, dependency behavior differing from repository comments, current advisories affecting locked versions, failed migration/partial startup, cancellation during provider or persistence work, and evaluators expecting an obsolete protocol.

At least one held-out challenge should target the highest-risk assumption not already directly exercised by the repository's own happy-path suite when feasible.

# Phase 11 — Finding synthesis

Create a finding only when evidence supports a material defect, risk, or violated technical requirement.

Use the full `CV-04` schema.

Each finding must make the causal chain inspectable:

**condition → violated invariant → actual behavior → consequence → evidence → remediation → verification**

Do not hide important uncertainty. If the conclusion depends on an unresolved fact that could reverse the finding or next action, mark it `DECISIVE_UNKNOWN`.

Do not inflate severity because confidence is low.

Avoid findings for style preference, speculative redesign, harmless inconsistency, scanner output with no candidate applicability analysis, theoretical behavior with no plausible path or scoped consequence, or missing tests when no underlying material risk can be articulated.

Test deficiencies may be findings when they materially undermine a required reliability/security boundary or create a demonstrated false-confidence/false-failure condition.

# Phase 12 — Remediation design

For each supported finding, propose the smallest safe remediation.

The remediation should specify the failure condition to remove, the boundary that should own the fix, invariants that must be preserved, expected compatibility/migration consequences, regression coverage, and the exact verification target.

Prefer repairing an existing boundary over inventing a new subsystem when the existing abstraction can safely enforce the invariant.

Broader architecture replacement requires evidence that the defect cannot be safely or sustainably corrected locally, or explicit user authority to explore architecture.

Suggested remediation is advisory unless implementation is separately authorized.

# Phase 13 — Audit completeness and stopping rule

A deep audit may finish when all of the following are true:

1. Candidate identity is immutable and recorded.
2. Intended behavior and authority basis are established for material conclusions.
3. Every HIGH-attention boundary has been directly inspected or explicitly blocked/excluded.
4. Material external assumptions have been independently challenged.
5. Material CI/test/scanner contradictions have been explained or preserved as uncertainty.
6. Execution evidence has targeted the most consequential discovered failure modes.
7. At least one held-out/adversarial challenge has been applied to the highest-risk unproven assumption when feasible.
8. Every finding has sufficient evidence, consequence, remediation, and verification.
9. Remaining `DECISIVE_UNKNOWN` facts have been resolved or force `UNKNOWN`/`BLOCKED`.
10. Coverage gaps and exclusions are reported.

Do not continue searching solely to create an appearance of comprehensiveness after the stopping rule is satisfied.

Do not claim exhaustive absence of defects unless the scope and method genuinely support completeness, which is uncommon for nontrivial software.

# Phase 14 — Revalidation and evidence invalidation

After remediation or other material change, determine which prior evidence remains valid.

Invalidate and refresh evidence when relevant inputs change, including candidate SHA/tree, affected source, dependency or lockfile, database schema/migration, compiler/runtime, OS/browser, provider/API version or behavior, configuration, CI/evaluator fixture, governing requirement, or external advisory state.

Do not rerun unrelated evidence ceremonially.

Retest the original failure condition first, then neighboring invariants plausibly affected by the fix.

A remediation is not verified merely because the repository returns to green.

# Phase 15 — Required deep-audit report

Use the standard `CV-04` report headings, with additional audit-specific detail:

**ASSESSMENT**

One of `NO_MATERIAL_FINDINGS`, `FINDINGS_PRESENT`, `BLOCKED`, or `UNKNOWN`.

**CANDIDATE**

Repository, ref, immutable revision, tree when available, dependency state, environment, audit date.

**SCOPE**

Requested scope, inspected components, HIGH-attention boundaries, explicit exclusions.

**INTENDED BEHAVIOR**

Applicable Owner/Core/Steward authority and technical invariants.

**AUDIT MAP**

Material entry points, state boundaries, trust boundaries, persistence, async/concurrency, external integrations, dependencies, and validation machinery.

**FINDINGS**

`CV-04` finding records ordered by consequence, not convenience.

**EXTERNAL CHALLENGE**

Material external assumptions, sources, version applicability, contradictions, and unresolved questions.

**VALIDATION EVIDENCE**

Exact commands, workflows, tests, runtime reproductions, CI jobs, static/dynamic tools, and what each result establishes.

**EVALUATOR INTEGRITY**

Material stale, skipped, overfit, contradictory, or noncanonical validation evidence.

**SUGGESTED REMEDIATION**

Smallest safe correction for each finding, including constraints and trade-offs.

**VERIFICATION**

Specific evidence required to prove each remediation addressed its original failure mode.

**COVERAGE / REMAINING UNCERTAINTY**

Uninspected boundaries, unavailable environments, external unknowns, non-exhaustiveness, and any `DECISIVE_UNKNOWN`.

**HANDOFF**

Bounded Coding Agent work, Steward/Owner escalation if required, and candidate identity for downstream user-facing validation.

# Phase 16 — Trace support

When requested, use `CV-TRACE-00`.

For a deep audit, `/trace scope` should expose the audit map, HIGH-attention boundaries, exclusions, and candidate identity. `/trace evidence` should distinguish authority, repository, execution, and external evidence and include claim states. `/trace external` should expose the assumption register and external-source applicability. `/trace finding <id>` should expose the evidence chain and remediation basis for that finding. `/trace full` should additionally show which audit lanes were completed, blocked, or excluded.

Trace observable evidence and routing only. Never expose hidden chain-of-thought.

# Future-conversation shorthand

When a future conversation says:

> Run the deep audit procedure on `<candidate>`.

Interpret that as:

1. load `LAT-SHARED-00`, `LAT-SHARED-01`, `CV-00`, and `CV-AUDIT-00`;
2. freeze the candidate;
3. default to `BASELINE_REVIEW`;
4. build the audit map and HIGH-attention boundary set;
5. route material inspection through `CV-01`–`CV-03`;
6. challenge external assumptions independently;
7. inspect relevant execution and evaluator evidence;
8. synthesize findings/remediation under `CV-04`;
9. report coverage and remaining uncertainty;
10. do not imply Product readiness, merge authorization, deployment authorization, or defect absence beyond the inspected scope.
