# CV-03 — External Evidence & Independent Challenge

## Purpose

Prevent repository self-confirmation by independently validating material technical assumptions whose truth exists outside the repository.

## Core rule

Never let the repository be both the claim and the independent evidence proving the claim.

Repository docs, tests, comments, prior reports, architecture, and implementation patterns can establish local intent or candidate state. They do not establish external API, runtime, protocol, security, compatibility, or platform facts merely because they agree with one another.

## External Challenge Pass

For every substantial validation, ask:

> What material assumption in this candidate would be most dangerous if the repository were wrong about it?

Then:

1. enumerate material assumptions implicated by the candidate;
2. classify each as **LOCAL**, **EXTERNAL**, or **MIXED**;
3. prioritize assumptions by potential effect on correctness, security, compatibility, or remediation;
4. verify external assumptions that could materially change the assessment;
5. actively look for contradictory or limiting evidence when the assumption is consequential;
6. record version/date/applicability;
7. preserve unresolved conflicts rather than smoothing them into confidence.

If no material external assumption exists, state that the External Challenge Pass found none requiring outside verification. Do not perform ceremonial research.

## When external verification is required

Use external sources when a material conclusion depends on:

- language specification or compiler behavior;
- runtime or memory semantics;
- framework/library/API guarantees;
- operating-system or hardware behavior;
- protocol or file-format requirements;
- cloud/vendor/service semantics;
- dependency compatibility or lifecycle;
- vulnerability/advisory state;
- cryptography or security controls;
- packaging, signing, provenance, or build semantics;
- current upstream bugs, deprecations, breaking changes, or supported versions.

## Source hierarchy

Choose sources according to the claim, not familiarity.

### Tier 1 — Normative / primary

Prefer when available:

- standards and specifications;
- language/runtime specifications;
- official vendor/platform/framework documentation;
- upstream maintainer documentation;
- upstream source for implementation facts;
- official security advisories;
- standards bodies and government technical standards.

### Tier 2 — Structured technical evidence

Examples:

- OSV/GHSA/CVE/NVD advisory data;
- CWE classifications;
- upstream release/changelog databases;
- compatibility matrices;
- standardized conformance data.

Use each only for claims it actually establishes.

### Tier 3 — Independent secondary evidence

Use reputable research papers, engineering analyses, independent reproductions, and maintainer issue discussions when primary evidence is incomplete, ambiguous, or contested.

### Tier 4 — Repository claims

Use local docs/comments/tests/prior reports for local intent and state. Do not promote them into external authority.

## Version and environment matching

Before relying on an external source, match material applicability:

- library/framework version;
- runtime/compiler version;
- operating system/platform;
- protocol/spec revision;
- API version;
- feature/configuration mode;
- release channel;
- date when behavior may have changed.

Documentation for another version is supporting context, not direct proof.

## Contract versus incidental behavior

Distinguish:

- **documented/specification guarantee** — behavior the implementation may rely on within the stated conditions;
- **observed upstream implementation behavior** — what a particular version currently does;
- **undocumented/incidental behavior** — may change and should not be treated as a stable contract without stronger evidence.

Upstream source can establish implementation reality for a version without necessarily establishing a supported API guarantee.

## Conflict handling

When current direct evidence conflicts:

- preserve both claims and their scopes;
- prefer the source authoritative for the specific fact;
- downgrade unsupported repository assertions;
- do not average incompatible evidence into a stronger conclusion;
- identify whether the conflict affects the finding, severity, remediation, or verification.

Examples:

- repository comment vs official API contract → official API contract controls external API semantics;
- test result vs language specification → test establishes observed environment behavior; specification establishes normative semantics for its scope;
- current vendor docs vs older blog post → current applicable vendor docs normally control;
- Product requirement vs external feasibility → Product authority still controls intent; external evidence may show the candidate cannot satisfy it as implemented.

## Search discipline

For a material external claim:

1. formulate the technical question independently of the repository's preferred answer;
2. search for the governing primary source;
3. open/read the source rather than relying solely on a search snippet;
4. verify version/applicability;
5. search for known caveats, exceptions, errata, advisories, or upstream issues when consequence is material;
6. cite the evidence next to the finding it supports.

A failed search does not prove absence unless the method and scope establish completeness.

## Privacy and outbound research

External research must not leak private repository content.

Do not send to public search/services:

- secrets or credentials;
- private keys/tokens;
- customer/user data;
- proprietary source snippets unless explicitly authorized and necessary;
- internal hostnames, identifiers, incident data, or confidential design details that are not already public.

Prefer sanitized queries built from public API names, error codes, version identifiers, public stack traces, standards terms, and minimal non-sensitive semantics.

If a technical question cannot be researched safely without disclosing sensitive information, preserve the limitation as `UNKNOWN` or `BLOCKED` depending on materiality.

## External evidence record

For material external evidence record:

- technical question;
- source and publisher/maintainer;
- source type/tier;
- relevant version/revision/date;
- what the source establishes;
- what it does not establish;
- candidate applicability;
- contradiction or caveat if any;
- freshness concern if any.

## No external-authority overreach

External technical sources do not establish Lattice Product philosophy, roadmap, UX intent, or authorization. They establish technical reality only within the claims they support.
