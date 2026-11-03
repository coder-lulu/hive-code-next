# Orca Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Orca
orchestration reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Orca orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Engage it as well
when you are a dispatched worker sending heartbeats, `ask` questions, or `worker_done`. Use
the orca-cli skill instead for full ownership handoffs ("hand off", "handoff", "handover",
"give this to another agent", "another worktree") when the user did not ask to supervise,
monitor, wait for results, or coordinate a DAG — and for ordinary terminal control, shell
commands, worktree management, and the built-in browser. Coordination requires real Orca
runtime state; never substitute a non-Orca subagent tool.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
hive skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop and dispatched-worker
obligations. For a conditional action gate such as remote placement, uncertain release
recovery, or expanded DAG work, load only the reference that gate names with
`hive skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`hive skills get orchestration --full` and read the named bundled reference before acting.

<!-- shared: no-guessing -->

## If an older HiveCode does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap:

```text
hive status --json
hive orchestration task-list --json
hive terminal list --json
```

Updating HiveCode restores the version-matched guide via `hive skills get orchestration`.
Beyond these commands, use the selected executable's help for read-only discovery without
guessing flags or changing runtime state.
