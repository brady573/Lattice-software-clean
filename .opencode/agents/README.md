# Agent prompts

Committed copies of the three Lattice agent prompts:

- `lattice-steward.md`
- `coding-agent.md`
- `validator-agent.md`

These files are the canonical, version-controlled copies. Before this directory
existed, these prompts lived only at `/root/.config/opencode/agents/`, outside
git, with no diff, no history, and no way to restore an edit.

## Where the live harness reads from

The live OpenCode harness loads its agent prompts from
`/root/.config/opencode/agents/`, not from this directory. The files here are a
faithful mirror, not the runtime source.

## Sync direction

**Edit the repo copy first, then copy it to the live harness location.**

```bash
cp .opencode/agents/lattice-steward.md /root/.config/opencode/agents/
cp .opencode/agents/coding-agent.md     /root/.config/opencode/agents/
cp .opencode/agents/validator-agent.md  /root/.config/opencode/agents/
```

Do not edit the live copy and copy back. Keeping one direction avoids the
divergent-pair failure mode where a prompt fix exists in only one place.

## What the guard test covers

`test/agent-source-integrity.test.ts` reads the repo copies in this directory. It
checks that every source path a prompt names resolves, that the source files
exist under their bare identifiers, and that the Steward state files are present.

It does **not** compare these files against the live harness copies. That
comparison would make the suite depend on `/root/.config` existing, so a missing
live copy would show up as a test failure rather than as an absent local
environment. The two copies staying identical is a manual sync obligation
described above.

## Frontmatter

The YAML frontmatter is a live harness contract. Preserve the `mode:`, `steps:`,
and `permissions:` blocks exactly as they are when editing prompt prose.
