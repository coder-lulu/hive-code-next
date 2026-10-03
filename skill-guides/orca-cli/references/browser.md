# Built-in browser commands

Use a snapshot-interact-re-snapshot loop:

```text
hive goto --url https://example.com --json
hive snapshot --json
hive click --element @e3 --json
hive snapshot --json
```

Common commands:

```text
hive goto --url <url> --json
hive back --json
hive reload --json
hive snapshot --json
hive screenshot --json
hive full-screenshot --json
hive pdf --json
hive click --element <ref> --json
hive fill --element <ref> --value <text> --json
hive type --input <text> --json
hive select --element <ref> --value <value> --json
hive check --element <ref> --json
hive scroll --direction down --amount 1000 --json
hive hover --element <ref> --json
hive focus --element <ref> --json
hive keypress --key Enter --json
hive upload --element <ref> --files <paths> --json
hive wait --text <text> --json
hive wait --url <substring> --json
hive wait --selector <css> --json
hive wait --load networkidle --json
hive eval --expression <js> --json
hive tab list --json
hive tab create --url <url> --json
hive tab switch --index <n> --json
hive tab close --index <n> --json
hive cookie get --json
hive capture start --json
hive console --limit 50 --json
hive network --limit 50 --json
hive exec --command "help" --json
```

Browser rules:

- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref`.
- Refs like `@e1` are assigned by `snapshot`, scoped to one tab, and invalidated by navigation or tab switch.
- Browser commands default to the current worktree and its active tab. Use `--worktree all` only intentionally.
- For concurrent browser work, run `hive tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- Use typed tab commands (`hive tab list/create/close/switch`), not `hive exec --command "tab ..."`, so HiveCode keeps UI state synchronized.
- Prefer `wait --text`, `--url`, `--selector`, or `--load` after async page changes instead of bare timeouts.
- Anything not listed above goes through `hive exec --command "<agent-browser command>"`.
- If `fill` or `type` fails on a custom input, try `hive focus --element @e1 --json` then `hive inserttext --text "text" --json`.
- A client-hosted page renders in the paired desktop's browser engine, so every command against it needs that desktop online and returns `browser_host_unavailable` while it is closed, asleep, or disconnected. Server-hosted pages run with no desktop attached; prefer them for long or unattended automation.

Common recoveries:

- `browser_no_tab`: open a tab with `hive tab create --url <url> --json`.
- `browser_stale_ref`: run `hive snapshot --json` and retry with fresh refs.
- `browser_tab_not_found`: run `hive tab list --json` before switching or closing.
- `browser_host_unavailable`: the desktop hosting the page is offline. Bring it back, or recreate the page with server placement if the work must outlive the desktop session.
