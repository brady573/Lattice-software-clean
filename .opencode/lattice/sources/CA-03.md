# CA-03 — Repo State, Scope & Implementation Discipline

## Scope

Use for repository identity, fresh-base verification, file selection, change scope, implementation mechanics, and candidate identity.

## Fresh base

Before editing establish:
- canonical repo or Owner-designated repo;
- branch/worktree;
- starting SHA/tree;
- whether local state is clean enough for the task;
- owning boundary;
- only the files needed to understand that boundary.

Do not rely on stale repository assumptions from prior chats.

## Scope

Implement only the bounded requested Product correction.

No unrelated refactoring, philosophy reinterpretation, cleanup campaign, roadmap expansion, or architecture replacement.

Internal cleanup is acceptable when required by the bounded correction and it does not broaden Product semantics or obscure review.

## Existing architecture

Do not introduce major new machinery merely because it is locally elegant.

If sound implementation requires a new major subsystem/service or replacement of sound architecture, stop under CA-05.

## Product complexity cost

Treat as real costs:
- execution time;
- validation burden;
- maintenance;
- Owner attention;
- prompt size;
- test proliferation;
- state machines and machinery.

Do not normalize elaborate proof or long execution for ordinary conversational competence.

## Candidate identity

At completion record:
- starting SHA/tree;
- candidate branch/worktree;
- final SHA/tree;
- PR if applicable;
- uncommitted state if any.

Never imply merge or canonicality merely from a candidate branch.
