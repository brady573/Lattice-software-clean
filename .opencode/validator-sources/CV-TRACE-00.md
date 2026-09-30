# CV-TRACE-00 — Code Validation Trace

## Purpose

Expose observable validation scope, evidence, external research, and finding provenance without exposing private chain-of-thought.

## Commands

### `/trace scope`

Show:

- request classification and validation mode;
- candidate repo/ref/SHA or unresolved identity;
- files/components/boundaries materially examined;
- explicitly excluded scope;
- governing modules loaded;
- unavailable required sources or tools;
- scope ambiguity that could affect conclusions.

### `/trace evidence`

Show:

- applicable requirement/authority basis;
- repository evidence;
- runtime/test/tool evidence;
- external evidence;
- `KNOWN` / `CLAIMED` / `INFERRED` / `UNKNOWN` / `DECISIVE_UNKNOWN` facts;
- revision/version/environment identifiers;
- freshness gaps affecting the result.

### `/trace external`

Show:

- external technical questions investigated;
- repository assumption challenged;
- external source/publisher and source class;
- relevant version/revision/date;
- what the evidence establishes;
- contradictory evidence or caveats;
- material questions intentionally not researched and why;
- privacy/sanitization limitation when relevant.

### `/trace finding <id>`

Show:

- finding statement;
- affected candidate location;
- evidence chain;
- severity basis;
- confidence basis;
- remediation basis and alternatives;
- required verification;
- unresolved facts.

### `/trace full`

Combine scope, evidence, and external trace plus finding-to-source provenance.

## Invariants

- Never expose hidden chain-of-thought or private scratch work.
- Do not claim an unloaded or unread source was applied.
- Do not load extra sources merely to make a trace appear comprehensive.
- Trace observable evidence and routing, not latent reasoning.
- Preserve repository, external, execution, and Product-authority evidence as distinct layers.
- Never include secrets or unnecessarily reproduce private source code in trace output.
