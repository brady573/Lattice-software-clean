# M7 — Conversation + Progress API Execution Handoff

Status: **NON-AUTHORITATIVE EXECUTION COORDINATION / HISTORICAL COMPLETION RECORD**

Historical bound repository state retained for provenance: `brady573/Lattice-Software` `main @ 4451a29006ee405dd95ccf197284a46046419517`, tree `6b21e51aeee46546e5756a4aa89e714cd7c95281`.

Canonical backend state used by M7-G2A and as the PR base: `main @ 4d9548b7e8c64b57c60eb37a9e605a1c391b810b`, tree `2ceb82637be453a2fe98baffaaa77714d858a522`.

Exact accepted PR candidate lineage: PR #120 branch `m7-g2b-authoritative-lifecycle`, culminating in validated head `8979616b690321658c7b67c0deb52926d623abc9`, tree `cb1446c69bb38f33658ec3bec27992d38fe4b1ce`.

PR #120 was squash-merged as `main @ 0423c1700d68298263f63b0ef6aea2b6d7fe420b`, tree `cb1446c69bb38f33658ec3bec27992d38fe4b1ce`. Canonical main then advanced through PR #122 to `4ec9cbcb4faca04896cecac310ed5e5e7e532e26`, tree `7e2f7674eb25e706f3206209b03ff596e1fa3779`, installing the Owner-approved foundational Product design principle without changing the M7 runtime surfaces.

Exact current-main M7 acceptance was executed on `main @ 4ec9cbcb4faca04896cecac310ed5e5e7e532e26` by manually dispatched GitHub Actions run `33296051622`, job `99215779464`.

This handoff records bounded M7 execution provenance. It does not create Product requirements, transfer validation to another revision, authorize deployment, declare production readiness, or supersede the canonical living design, the Owner-approved foundational Product design principle, the v0.6 living-design amendment, the Owner-confirmed OD-001 through OD-004 record, protected V36 contracts, or exact repository evidence.

## Governing Product direction

M7 is the Conversation + Progress API milestone. The confirmed Product journey remains ordinary-language USER input -> Lattice Intent Authority -> exact IntentVersion -> DecisionPlan / Execution Runtime -> V36 Truth Core -> Lattice Decision Engine -> faithful Solandra Experience -> conversational continuation.

The living design's M7 exit criterion is controlling: reconnectable progress + polling + history must work across restart; the user-visible lifecycle must be coherent; and the development-only simulated conversation does not satisfy the gate.

M7 preserves established semantic authorities. Transcript text remains context/provenance rather than canonical intent; client-local reconnect state is not Product authority; V36 owns epistemic admission/judgment; the Decision Engine owns authoritative decision/frontier semantics; Solandra is presentation and USER advocacy, not truth or decision authority.

The Owner-approved foundational Product filter is also satisfied by the bounded M7 implementation: it removes the user-facing barrier between a natural-language conversation and the existing durable knowledge/decision lifecycle, while preserving the trust, semantic-authority, user-control, and validation boundaries that make the result trustworthy. It reuses existing durable Product machinery instead of adding duplicate backend complexity, and the improvement is Product-observable through the real-browser acceptance trace.

## M7-G2A — durable backend trace

**Status: PASSED on exact canonical main `4d9548b7e8c64b57c60eb37a9e605a1c391b810b`.**

The PostgreSQL-backed trace established:

- durable Conversation creation and identity;
- bounded ordinary-language USER intake through Lattice Intent Authority;
- durable USER source-message provenance;
- exact IntentVersion -> DecisionPlan -> Run binding;
- polling, durable event history, and reconnectable SSE using `Last-Event-ID`;
- terminal authoritative result under the existing offline V36 path;
- API/runtime restart against the same PostgreSQL state;
- continuity reconstruction of historical USER message, exact binding, Run, result, and event history; and
- later USER continuation without retroactively changing the historical binding.

No duplicate Conversation, persistence, continuity, or SSE infrastructure was required.

## M7-G2B — authoritative Knowledge Orbit integration

**Status: MERGED through PR #120 and present on current canonical main.**

The bounded client integration:

- enables the Knowledge Orbit composer on the authoritative Product runtime surface;
- stores only a Conversation reconnect pointer locally, not canonical Product state;
- submits USER turns through the existing authoritative `clear-user-messages` Intent Authority route;
- reads exact DecisionPlan material from the existing API instead of inferring authoritative intent from transcript text;
- presents durable Run progress through SSE with polling fallback;
- presents persisted terminal results only after authoritative completion;
- reconstructs durable USER history and Run/result continuity after reload;
- keeps the development-only simulated conversation separate and non-authoritative;
- does not add backend conversation persistence, new SSE authority, V36 semantics, Decision Engine semantics, arbitrary assistant-message persistence, M8 auth/privacy, M9 provider behavior, or production behavior.

## M7-G2C — exact real-browser lifecycle acceptance

### Accepted PR-candidate evidence

The PR candidate was accepted on exact branch revisions before integration, including final PR head `8979616b690321658c7b67c0deb52926d623abc9`. Exact candidate validation included Windows, prototype, PostgreSQL, and real Microsoft Edge lanes. Historical browser artifacts remain useful as candidate provenance but do not establish acceptance for later revisions by themselves.

### Exact current-main acceptance

**Status: PASSED on exact canonical `main @ 4ec9cbcb4faca04896cecac310ed5e5e7e532e26`.**

Execution surface:

- GitHub Actions workflow run `33296051622`, job `99215779464`;
- exact checkout SHA `4ec9cbcb4faca04896cecac310ed5e5e7e532e26` before and after acceptance;
- self-hosted Windows X64 runner `lattice-windows-01`, machine `BRADYS-COMP`;
- Node `24.19.0`, npm `11.17.0`;
- native PostgreSQL 18.6, server version `180006`, dedicated non-production database `lattice_test`;
- installed Microsoft Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
- no production deployment, production database mutation, or live-provider activation.

Exact same-job validation before the browser trace:

- repository gate: 284 tests, 252 passed, 0 failed, 32 PostgreSQL-dependent skips in the non-DB pass;
- native PostgreSQL durability surface: 49/49 passed, 0 failed, 0 skipped;
- dedicated browser schema reset and migration passed.

Observed real-browser acceptance:

1. Edge opened the authoritative Product runtime and established a durable Conversation.
2. Two visible USER turns used the authoritative `clear-user-messages` route; simulated-conversation requests remained zero.
3. Visible progress displayed licensed DecisionPlan material: `$1,300 maximum`, `12 hours minimum`, `Performance first`.
4. The API process was physically stopped while the initial SSE stream was active, producing a real transport interruption while PostgreSQL state remained durable.
5. Edge reconnected with `Last-Event-ID: 1`; the first resumed durable event was `2`, and event `1` was not replayed.
6. The first Run reached and displayed its persisted authoritative terminal result.
7. Browser reload reconstructed the same durable Conversation, USER history, historical exact binding, and persisted result.
8. A later material USER budget correction created a new exact IntentVersion/Run and reached a second persisted result.
9. The first historical Run binding remained unchanged after the later continuation.
10. Solandra remained in a non-result `working` presentation state before authoritative completion and did not fabricate a winner.

Exact current-main markers included:

- `M7_BROWSER_ACCEPTANCE=PASS`
- `M7_BROWSER_AUTHORITATIVE_USER_TURNS=PASS count=2`
- `M7_BROWSER_TRANSIENT_SIMULATOR_ISOLATION=PASS requests=0`
- `M7_BROWSER_LICENSED_PROGRESS=PASS budget=$1,300 maximum battery=12 hours minimum priority=Performance first`
- `M7_BROWSER_SSE_RECONNECT=PASS lastEventId=1 resumedEventId=2`
- `M7_BROWSER_TERMINAL_RESULT=PASS`
- `M7_BROWSER_RELOAD_CONTINUITY=PASS`
- `M7_BROWSER_CONTINUATION_HISTORY_IMMUTABLE=PASS`
- `M7_BROWSER_SOLANDRA_AUTHORITY_BOUNDARY=PASS preTerminalState=working`
- `M7_G2C_BROWSER_LIFECYCLE=PASS sha=4ec9cbcb4faca04896cecac310ed5e5e7e532e26`
- `M7_G2C_REPOSITORY_CHECK=PASS sha=4ec9cbcb4faca04896cecac310ed5e5e7e532e26`
- `M7_G2C_POSTGRES_DURABILITY_REGRESSION=PASS sha=4ec9cbcb4faca04896cecac310ed5e5e7e532e26`
- `M7_G2C_REAL_BROWSER=PASS sha=4ec9cbcb4faca04896cecac310ed5e5e7e532e26`.

Exact current-main browser evidence artifact:

- artifact ID `9727443362`;
- name `m7-browser-lifecycle-4ec9cbcb4faca04896cecac310ed5e5e7e532e26`;
- SHA-256 digest `cf0942ae9c36e10ede88a86329364ae952cc7241847ff116b95a8f3d0571bf43`;
- retained for 14 days from the run.

Independent current-main push validation for PR #122 also passed Windows Validation run `33295684790` and Windows Prototype Validation run `33295684759`. The exact manually dispatched browser run independently reran the repository gate and complete 49-test PostgreSQL durability surface, so the M7 milestone conclusion does not rely on validation transfer from the earlier merge or PR candidate.

## M7 milestone reconciliation

**M7 — Conversation + Progress API: COMPLETE / EXACT-CURRENT-MAIN ACCEPTED on `4ec9cbcb4faca04896cecac310ed5e5e7e532e26`.**

The exact canonical revision satisfies the applicable living-design exit criterion: durable Conversation/message history, polling and reconnectable progress work across restart, the authoritative user-visible lifecycle composes coherently in a real browser, and the transient simulated-conversation surface does not masquerade as Product authority.

This completion statement remains revision-bounded. A later main revision must be rebound and validated under the normal cross-revision rule before a freshness-sensitive current-main acceptance claim is made. M7 completion does not establish production deployment/readiness, M8 auth/privacy completion, M9 provider qualification, or M10 generalized explanation acceptance.

## Next bounded frontier

M7 execution work is complete. The next Product milestone is **M8 — Auth + privacy + continuity**, but its first Work Item must be rebound from fresh qualified Product sources before implementation.

This handoff is no longer an active M7 implementation instruction. Retain it as bounded acceptance provenance and rebind it only when M7 history or regression context is materially relevant.

## Explicit non-goals / unclaimed state

- M8 authentication, tenant isolation, retention/deletion, preference continuity, or cross-conversation memory.
- M9 live-provider activation, paid-provider enablement, or live research qualification.
- OD-006 / M10 generalized Solandra explanation licensing.
- Production deployment, production database mutation, secret rotation, paid infrastructure, or billing/security changes.
- Treating V7 Simulation Lab output, transient model output, browser-local state, or transcript text as Lattice Product authority.
- Transferring current-main acceptance to a later unvalidated revision by assumption.

## Completion rule

This handoff is complete when it accurately records the exact canonical M7 acceptance and its revision-bounded provenance. It is not itself acceptance evidence and must be rebound against fresh GitHub state before future use.
