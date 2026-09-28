# CV-02 — Security, Dependencies & Supply Chain

## Scope

Use when a candidate materially touches security boundaries, sensitive data, authentication/authorization, dependency risk, build integrity, artifact provenance, or software supply-chain concerns.

Security review is scoped. Do not claim a system is “secure” merely because no issue was found in the reviewed change.

## Security review lenses

Apply as relevant:

- input validation and canonicalization;
- output encoding;
- authentication and session handling;
- authorization and privilege checks;
- tenant/user isolation;
- secret and credential handling;
- cryptography and key management;
- sensitive-data exposure and retention;
- command/query/template construction;
- filesystem and path handling;
- network and SSRF boundaries;
- deserialization/parsing;
- redirects and URL handling;
- logging/telemetry leakage;
- error disclosure;
- configuration and secure defaults;
- unsafe dynamic loading or execution;
- sandbox/process boundaries;
- dependency and transitive dependency exposure;
- CI/build/release trust boundaries.

For diff reviews, inspect affected controls and newly introduced trust boundaries, not only changed lines.

## External security evidence

Security claims often depend on evolving external facts. Route them through `CV-03` and prefer appropriate primary or structured sources.

Examples:

- NIST guidance for secure-development process claims;
- OWASP guidance for secure code-review coverage;
- vendor/framework security documentation for platform-specific controls;
- OSV/GHSA/CVE/NVD or vendor advisories for known vulnerability state;
- CWE for weakness classification;
- SLSA specifications for supply-chain provenance concepts.

Do not treat a taxonomy as exploit proof.

## Dependency validation

When dependencies are material:

1. establish the exact dependency and version from the candidate's effective/locked state;
2. determine whether the vulnerable or incompatible component is actually present in the relevant build/runtime;
3. check authoritative advisories and upstream release information;
4. distinguish package affectedness from candidate reachability/exploitability;
5. identify fixed versions or mitigations from authoritative sources when available;
6. inspect migration/compatibility consequences of the proposed upgrade;
7. verify remediation against the resolved dependency graph, not only a manifest edit.

Do not report a package as safe solely because a scanner is quiet; scanner coverage and database freshness are separate evidence questions.

## Vulnerability evidence states

Keep these claims distinct:

- **Known affected package/version** — advisory evidence matches resolved package identity/version.
- **Reachable vulnerable path** — candidate evidence establishes the relevant code path can execute.
- **Exploitable condition** — required attacker-controlled conditions and impact are sufficiently established.
- **Mitigated exposure** — a control prevents the material exploit condition in the candidate environment.

Do not collapse them into one claim.

## Weakness classification

CWE can classify the type of a confirmed or suspected weakness. A CWE match does not independently establish that the candidate contains an exploitable vulnerability.

Use classification only when it improves communication, remediation, or downstream tooling.

## Static and dynamic security tools

SAST, CodeQL, dependency scanners, DAST, fuzzers, sanitizers, secret scanners, and similar tools are evidence producers.

For each material alert:

- identify the exact rule/query/source;
- inspect the data/control flow or dependency evidence behind it;
- confirm candidate applicability;
- classify false positive, supported finding, or unresolved signal;
- record tool version/configuration when material.

Do not promote an alert to a defect solely because the tool labels it high severity.

## Supply-chain and provenance checks

When artifact integrity matters, establish what produced the artifact and from which source revision when evidence is available.

Distinguish:

- source identity;
- build environment/process;
- artifact digest/identity;
- attestation/provenance;
- signature/verification;
- deployment identity.

A filename, CI status, or human claim is not provenance by itself.

## Reference anchors

These are external technical references, not Lattice Product authority. Validate current versions when material:

- NIST Secure Software Development Framework (SSDF): https://csrc.nist.gov/projects/ssdf
- OWASP Secure Code Review Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html
- OSV-Scanner: https://google.github.io/osv-scanner/
- GitHub CodeQL documentation: https://docs.github.com/en/code-security/code-scanning
- MITRE CWE: https://cwe.mitre.org/
- SLSA specification: https://slsa.dev/spec/

Do not substitute these general references for the specific framework/vendor/specification source that directly governs the candidate's behavior.
