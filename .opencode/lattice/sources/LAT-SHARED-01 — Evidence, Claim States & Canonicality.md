# LAT-SHARED-01 — Evidence, Claim States & Canonicality

> Draft shared Project Source. Install the same revision in all three Lattice projects.

## Purpose

Give all three projects one evidence vocabulary while allowing each role to use the subset relevant to its work.

## Claim states

### KNOWN
Reliably supported by current direct evidence appropriate to the claim.

Examples:
- current file contents;
- observed runtime behavior;
- tool output;
- current SHA/tree;
- direct canonical Product observation.

### CLAIMED
Asserted by a person, agent, artifact, comment, PR, test description, or prior report but not independently established for the current decision.

### INFERRED
Reasonably derived from known evidence but not directly established.

### UNKNOWN
Not established.

### DECISIVE_UNKNOWN
An UNKNOWN that could materially change:
- Product verdict;
- implementation authority;
- scope;
- safety/trust boundary;
- next action.

Do not convert CLAIMED, INFERRED, UNKNOWN, or DECISIVE_UNKNOWN into KNOWN through repetition.

## Evidence identity

Record revisions when material:
- repo and SHA/tree;
- branch/candidate identity;
- test command and result;
- canonical Product surface;
- environment/date;
- artifact version;
- Owner/Steward directive revision.

Old evidence is not automatically current evidence.

## Canonicality

Evidence is only as broad as the surface it establishes.

Examples:
- unit test → tested unit behavior;
- direct subsystem call → subsystem behavior;
- prototype → prototype behavior;
- candidate branch → candidate behavior;
- canonical Solandra route → canonical Product behavior.

Do not substitute a noncanonical surface for a canonical Product claim unless the claim is explicitly limited to that surface.

## Evidence hierarchy depends on the claim

For Product user experience, direct canonical Product evidence normally outranks evidence that supporting machinery exists.

For repository implementation state, fresh repository/tool evidence outranks prior reports.

For Product authority, the Owner/Core authority chain outranks observed implementation.

## Negative evidence

A failed or empty search does not prove absence unless the search method and scope establish completeness for the claim. A filtered, scoped, paginated, trigger-specific, status-specific, or otherwise partial query establishes only that its searched subset produced no result.

Before using absence as a material premise, either establish search completeness for the relevant evidence surface or preserve the fact as `UNKNOWN`. Never strengthen “not found by this method” into “does not exist.”

When direct evidence for the same immutable candidate is later discovered, it supersedes only the incompatible evidence-state or conclusion; still-valid evidence remains reusable.

## Contradictory evidence

When current direct evidence contradicts a prior claim:
- preserve the contradiction;
- downgrade or withdraw the unsupported claim;
- do not average incompatible evidence into a stronger conclusion.

## Freshness

Refresh evidence when behavior, code, dependencies, environment, Product requirements, evaluator, model/provider, or canonical route materially changes.
