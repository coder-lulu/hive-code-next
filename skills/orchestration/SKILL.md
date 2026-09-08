---
name: orchestration
description: >-
  Coordinate supervised HiveCode workers: threaded messages, blocking ask/reply,
  task dispatch, worker_done/escalation waits, task DAGs, decision gates,
  coordinator loops, and decomposing work across agents. Use `orca-cli` for full
  ownership handoffs — "hand off", "handoff", "handover", "give this to another
  agent", "another worktree" — unless asked to supervise, monitor, or coordinate
  a DAG, and for terminal control, lightweight terminal prompts, shell commands,
  HiveCode worktree management, and reading or waiting on terminals. Use Computer
  Use for external browser windows, webviews, HiveCode app UI, or desktop UI outside
  HiveCode's embedded browser only when the task requires OS/window-level control
  such as focus, menus, dialogs, coordinates, or screenshots. Use `orca-cli` for
  HiveCode's embedded pages and a page-automation tool such as Playwright or CDP for
  external pages.
---

# HiveCode Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched HiveCode
orchestration reference is served by the `hive` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage HiveCode orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the orca-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real HiveCode runtime
state; never substitute a non-HiveCode subagent tool.

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
hive skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`hive skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`hive skills get orchestration --full` and read the named bundled reference before acting.

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
hive orchestration task-list --json
hive terminal list --json
```

Then tell the user that updating HiveCode restores the full, version-matched guide via
`hive skills get orchestration`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
