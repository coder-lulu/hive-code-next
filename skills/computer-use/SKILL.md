---
name: computer-use
description: >-
  OS/window-level inspection and input in visible local app windows through `hive computer`:
  native apps, external browser windows (Chrome, Edge, Safari), and app webviews. Not for
  HiveCode's embedded browser (use `orca-cli`) or page-only automation (use Playwright or CDP).
---

# Computer Use

This discovery stub loads the version-matched guide from the HiveCode executable used for this session.

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

The same executable selection works in POSIX shells, PowerShell, and cmd.exe.

## Load the version-matched guide before running HiveCode commands

```text
hive skills get computer-use
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If HiveCode is not running, start it with `hive open --json` and retry.
If `skills get` is unknown, use the bounded read-only fallback below; do not guess flags.

## If an older HiveCode does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
hive status --json
hive computer capabilities --json
hive computer list-apps --json
```

Then tell the user that updating HiveCode restores the full, version-matched guide via
`hive skills get computer-use`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
