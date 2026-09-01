---
name: orca-per-workspace-env
description: >-
  Set up, review, debug, or validate HiveCode per-workspace environment recipes —
  on-demand, disposable runtimes (cloud sandboxes, VMs, or local) created fresh
  for each workspace. Covers first-time setup (provider prerequisites, the
  reusable base snapshot, the coding-agent auth snapshot, credentials, and
  state), not just the per-workspace lifecycle scripts. Use to stand up
  per-workspace environments, fix an `environmentRecipes` entry in `orca.yaml`, scaffold
  provider lifecycle scripts, or resolve an `hive vm recipe doctor` failure.
---

# Per-Workspace Environments

This file is a discovery stub, not the usage guide. The full, version-matched per-workspace
environment reference is served by the `hive` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage HiveCode whenever you set up, review, debug, or validate a per-workspace environment
recipe — the on-demand, disposable runtimes (cloud sandboxes, VMs, or local) created fresh
for each workspace. This covers first-time setup (provider prerequisites, the reusable base
snapshot, the coding-agent auth snapshot, credentials, and state), not just the
per-workspace lifecycle scripts. Use it to stand up per-workspace environments, fix an
`environmentRecipes` entry in `orca.yaml`, scaffold provider lifecycle scripts, or resolve
an `hive vm recipe doctor` failure. HiveCode is a thin wrapper: you guide, detect, and scaffold;
you never own the user's cloud account, billing, images, or credentials, and never spend
money without an explicit user OK.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- Use `hive` in current production builds.
- If the compatibility environment variable `ORCA_CLI_COMMAND` is set, use its value instead;
  HiveCode exports it when a managed session must pin a specific executable.
- Older development, Linux, or production installs may expose `orca-dev`, `orca-ide`, or
  `orca`. Treat these as compatibility aliases and use one only when `hive` is unavailable.
  On unmanaged Linux, never try bare `orca` first because it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.

Examples use the current `hive` command. Substitute the pinned executable or a legacy alias
only when the active HiveCode build requires it. If that executable cannot run, report its
exact error and stop; do not fall through to another executable that may target a different
HiveCode build.

## Load the full guide before running HiveCode commands

```text
hive skills get orca-per-workspace-env
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — provider setup, base and auth snapshots, `environmentRecipes` in
`orca.yaml`, lifecycle scripts, and `hive vm recipe doctor`. Read it first, then run the
specific command you need.

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between HiveCode releases, and this file deliberately no longer lists them. Confirm the
app is up with `hive status --json` (start it with `hive open --json` if needed), and
prefer `--json` for agent-driven calls.

## If an older HiveCode does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
hive status --json
hive vm recipe doctor <recipe-id> --repo-path <repo> --json
```

The doctor command above is the free static check. Never add `--provision` without the
user's explicit approval because it creates provider resources and may spend money.

Then tell the user that updating HiveCode restores the full, version-matched guide via
`hive skills get orca-per-workspace-env`. Beyond these commands, ask the user rather than
guessing a command surface this older binary may not support.
