---
name: orca-emulator
description: >
  Control a mobile (iOS) emulator / simulator stream from inside HiveCode using the `orca` CLI.
  Use for taps, gestures, typing, hardware buttons, camera injection, permissions, accessibility tree, and more — all while seeing the live view in HiveCode's emulator pane.
  Prefer this over raw `npx serve-sim` or direct simctl when running agents inside HiveCode (the orca surface handles device scoping, helper lifecycle, and worktree context).
  Complements the orca-cli skill for terminals, worktrees, and the built-in browser.
license: Apache-2.0
---

# HiveCode Emulator

This file is a discovery stub, not the usage guide. The full, version-matched HiveCode emulator
reference is served by the `orca` binary itself — kept out of this file on purpose so it can
never drift from the binary that will actually run your commands.

Engage HiveCode whenever you drive a mobile (iOS) emulator / simulator stream from inside the
HiveCode app: taps, gestures, typing, hardware buttons, camera injection, runtime permissions,
the accessibility tree, and more — all while the live view stays in HiveCode's emulator pane.
Prefer this over raw `serve-sim` or direct `simctl` when running agents inside HiveCode, which
handles device scoping, helper lifecycle, and worktree context for you. It complements the
orca-cli skill for terminals, worktrees, and the built-in browser.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. HiveCode exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside a HiveCode-managed terminal, use `orca-ide`. Never run bare
  `orca` there — outside HiveCode's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different HiveCode build.

## Load the full guide before running HiveCode commands

```text
ORCA skills get orca-emulator
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — booting devices, taps and gestures, typing, hardware buttons, camera
injection, permissions, and the accessibility tree. Read it first, then run the specific
command you need.

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between HiveCode releases, and this file deliberately no longer lists them. Confirm the
app is up with `ORCA status --json` (start it with `ORCA open --json` if needed), and
prefer `--json` for agent-driven calls.

## If an older HiveCode does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
ORCA status --json
ORCA emulator list --json
```

Then tell the user that updating HiveCode restores the full, version-matched guide via
`ORCA skills get orca-emulator`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
