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

## Load the full guide before acting

```text
ORCA skills get hivecode-android-ui
```

Resolve `ORCA` once using `ORCA_CLI_COMMAND`, then `orca-dev` in a development
checkout exposing `ORCA_DEV_REPO_ROOT`, `orca-ide` on unmanaged Linux, or `orca`
elsewhere. `ORCA` is a placeholder; substitute the executable and do not run it
literally. Read the returned guide before starting an emulator or editing the
mobile UI. It links the lower-level `orca-emulator-android` command surface.

## If an older HiveCode does not recognize `skills get`

Use only this bounded, read-only fallback to orient the session:

```text
ORCA status --json
ORCA emulator devices --json
```

If those commands work, continue the UI implementation with the checked-in
`mobile/README.md` and the Windows `adb` fallback described in the project
documentation, then tell the user that updating HiveCode restores the full
version-matched guide. Do not invent additional ORCA flags or silently switch
to another executable.
