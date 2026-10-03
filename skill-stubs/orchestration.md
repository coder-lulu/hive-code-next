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

<!-- shared: resolver -->

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

<!-- shared: no-guessing -->

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
