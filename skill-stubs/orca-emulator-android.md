# HiveCode Emulator (Android)

This discovery stub loads the version-matched guide from the HiveCode executable used for this session.

<!-- shared: resolver -->

## Load the version-matched guide before running HiveCode commands

```text
hive skills get orca-emulator-android
```

<!-- shared: no-guessing -->

## If an older HiveCode does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
hive status --json
hive emulator devices --json
```

Then tell the user that updating HiveCode restores the full, version-matched guide via
`hive skills get orca-emulator-android`. Beyond these commands, ask the user rather than
guessing a command surface this older binary may not support.
