---
name: computer-use
description: >-
  Use HiveCode's computer-use CLI for OS/window-level inspection and input in visible
  local app windows. Use when a task must read or operate a native app or an
  external browser window (for example, Chrome, Edge, or Safari) or an app
  webview. Do not use for HiveCode's embedded browser or page-only browser
  automation. Use `orca-cli` for HiveCode's embedded pages and a page-automation
  tool such as Playwright or CDP for external pages.
---

# Computer Use

This file is a discovery stub, not the usage guide. The full, version-matched computer-use
reference is served by the `hive` binary itself — kept out of this file on purpose so it can
never drift from the binary that will actually run your commands.

Engage HiveCode's computer-use surface when a task requires desktop-level access to a visible local
app or window, including a native app or an external browser window/webview. Do not use for
HiveCode's embedded browser or page-only browser automation. Use `orca-cli` for HiveCode's embedded
pages and a page-automation tool such as Playwright or CDP for external pages.

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
hive skills get computer-use
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — listing apps/windows, reading UI, and driving clicks, typing, and other
accessibility actions. Read it first, then run the specific command you need.

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
hive computer capabilities --json
hive computer list-apps --json
```

Then tell the user that updating HiveCode restores the full, version-matched guide via
`hive skills get computer-use`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
