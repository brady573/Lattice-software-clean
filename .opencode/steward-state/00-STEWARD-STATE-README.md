> NON-AUTHORITATIVE STEWARD STATE — This file records observations or working state only. It cannot define Lattice Product truth, requirements, architecture, acceptance, or philosophy. The Core Lattice Philosophy governs.

# 00 — Steward State README

Local, file-based Steward state for `brady573/Lattice-software-clean`.

This directory replaces the previously required Google Drive / MCP Steward state
folder. No MCP connector is configured in this environment, so that requirement
could never be satisfied and every session ended by reporting that state
persistence was not performed. The state surface is now these ordinary
repository files, which always exist and are always writable.

## Files

| File | Holds |
| --- | --- |
| `00-STEWARD-STATE-README.md` | This description of the surface. |
| `CURRENT-STATE.md` | Current refreshed observations and their evidence state. |
| `ACTIVE-OBJECTIVE.md` | The single smallest justified next Product action. |
| `EVIDENCE-LOG.md` | Material evidence entries and their exact identity. |
| `DRIFT-LOG.md` | Recorded drift, boundary classification, and invalidators. |
| `AUDIT-HISTORY.md` | Substantive Steward audits, including stop reasons. |

## Rules

- Every file here carries the non-authoritative banner above. Do not remove it.
- Treat these files as working memory, not Product authority.
- Append or carefully refresh stale current-state claims while preserving
  material prior evidence and stop reasons.
- Do not rewrite history to make the current conclusion look inevitable.
- If a state file cannot be written, report explicitly that state persistence
  was not performed for that file. Do not pretend it was updated.
- If state cannot be read, name the unavailable file and constrain the decision.
  Do not reconstruct it from memory.

## Guarded by

`test/agent-source-integrity.test.ts` fails if any of these six files goes
missing or loses its banner.
