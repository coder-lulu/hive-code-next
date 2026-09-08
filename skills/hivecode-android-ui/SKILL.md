---
name: hivecode-android-ui
description: >
  Design, run, debug, and visually verify HiveCode's React Native Android client
  with the local Expo/Metro stack and an adb-connected emulator. Use when an
  Android UI change must preserve existing mobile logic and be checked on a real
  emulator; for device-only control without UI work, use the dedicated Android
  emulator skill instead.
license: Apache-2.0
---

# HiveCode Android UI

This file is a discovery stub. The full, version-matched HiveCode Android UI
workflow is embedded in the HiveCode CLI and is kept out of this projection so
the installable skill cannot drift from the binary that serves it.

Use this skill when implementing or reviewing a React Native Android UI change
in the HiveCode repository and you need the complete loop: inspect the existing
screen and theme, start/attach an adb emulator, run Expo/Metro and the desktop or
mock WebSocket transport, preserve product logic, capture screenshots and
accessibility output, and run mobile tests. It also records the Windows SDK
fallback and the project-specific startup/recovery traps. For raw emulator
control without UI work, use `orca-emulator-android` instead.

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

## Load the full guide before acting

```text
hive skills get hivecode-android-ui
```

Read the returned guide before starting an emulator or editing the mobile UI. It
links the lower-level `orca-emulator-android` compatibility skill.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If HiveCode is not running, start it with `hive open --json` and retry.
If `skills get` is unknown, use the bounded read-only fallback below; do not guess flags.

## If an older HiveCode does not recognize `skills get`

Use only this bounded, read-only fallback to orient the session:

```text
hive status --json
hive emulator devices --json
```

If those commands work, continue the UI implementation with the checked-in
`mobile/README.md` and the Windows `adb` fallback described in the project
documentation, then tell the user that updating HiveCode restores the full
version-matched guide. Do not invent additional HiveCode CLI flags or silently switch
to another executable.
