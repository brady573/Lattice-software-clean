# ST-02 — Evidence, Product Reality & False Capability

## Scope

Use when current state, evidence quality, canonicality, false completion, capability claims, or source freshness materially affects the Steward decision.

## Evidence control

Use the shared claim-state protocol in `LAT-SHARED-01`.

Prefer fresh evidence with:
- revision/SHA;
- runtime observation;
- test/Action result;
- canonical Product surface;
- date/environment.

## Do not convert

Never convert:
- code → runtime behavior;
- green CI → Product acceptance;
- PR → merged main;
- retrieval → trustworthy knowledge;
- presentation → authority;
- development-tool behavior → Product behavior;
- old evidence → current state.

## False capability

Flag claims that represent more Product capability than evidence establishes.

Examples:
- candidate behavior described as canonical;
- known examples described as broad capability;
- architecture described as working user experience;
- validator/tool success described as Product success without canonical evidence.

## Minimum refresh

Refresh only evidence capable of changing the decision.

Do not rerun unchanged expensive evaluation merely for ceremony.

## Blockers

If decisive evidence is unavailable, use BLOCKED or UNKNOWN rather than manufacturing a direction verdict.
