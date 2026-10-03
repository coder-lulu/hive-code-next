---
name: orca-emulator
description: >-
  iOS Simulator control from inside HiveCode, with the live device view in HiveCode's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# HiveCode Emulator (iOS)

Examples use `hive`; substitute the session-pinned executable from `ORCA_CLI_COMMAND` when set.

## Command surface

`hive emulator --help` lists the wrapped verbs. Anything else goes through
`hive emulator exec --command "<serve-sim command>"`, which forwards the string to serve-sim
unvalidated with the active device injected.

`install`, `launch`, `permissions`, and `logcat` are Android-only and fail against an iOS
device with `emulator_unsupported`. `tap`, `type`, `gesture`, `button`, `rotate`, `ax`, and
`exec` work on both backends.

Emulator control is local to the Mac that owns the simulator; remote and SSH worktrees are
out of scope.

## Prerequisites

- macOS with the Xcode Command Line Tools (`xcrun --version`).
- A booted simulator (`xcrun simctl list devices booted`), or let `attach` boot one.
- An active session for the worktree before any input verb: run `hive emulator attach` or
  open the emulator pane.
- In a `pnpm dev` checkout, run `pnpm build:cli` before the first emulator command so the
  dev CLI shim reaches this worktree's runtime instead of a packaged install.

HiveCode reports a clear error when the host is missing macOS or the Xcode tools.

## Operations

Use `--json` for agent-driven calls. Unqualified commands target the worktree's active
device.

| Goal                     | Command                                                     | Constraint                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List available / running | `hive emulator list --json`                                 | HiveCode-managed sessions plus raw serve-sim streams. Use its ids for `--device` / `--emulator`.                                                                          |
| List devices everywhere  | `hive emulator devices --json`                              | Every backend's devices with a platform column, booted and shutdown.                                                                                                  |
| Attach / make active     | `hive emulator attach "iPhone 16 Pro" --json`               | Starts the helper if needed and makes the device active for the worktree. `--focus` switches the UI; it does not by default.                                          |
| Single tap               | `hive emulator tap <x> <y> --json`                          | Normalized 0..1 coordinates.                                                                                                                                          |
| Multi-step gesture       | `hive emulator gesture '<json>' --json`                     | Begin/move/end points. Use `tap` for a single tap.                                                                                                                    |
| Type text                | `hive emulator type "text" --json`                          | US-ASCII only.                                                                                                                                                        |
| Hardware button          | `hive emulator button home --json`                          | `home` and `side_button` are documented by the CLI spec; other names such as `swipe_home`, `app_switcher`, `lock`, and `siri` are forwarded to serve-sim unvalidated. |
| Rotate device            | `hive emulator rotate landscape_left --json`                | The orientation persists for subsequent gestures.                                                                                                                     |
| Accessibility tree       | `hive emulator ax --json`                                   | serve-sim node tree, capped at 500 nodes, frames normalized 0..1 with a top-left origin. Needs an active session.                                                     |
| Raw passthrough          | `hive emulator exec --command "ca-debug blended on" --json` | serve-sim subcommand string, without a `serve-sim` prefix.                                                                                                            |
| Stop the helper          | `hive emulator kill --json`                                 | Leaves the device booted.                                                                                                                                             |
| Stop and power off       | `hive emulator shutdown --json`                             | Stops the helper and shuts the simulator device down.                                                                                                                 |

## Targeting

`attach`, or opening the emulator pane, makes one device active per worktree, and unqualified
commands target it. Pass a selector only to override that or reach a second device. With no
active session an unqualified command fails with `emulator_no_active`; attach or open the pane
and retry.

- `--device "iPhone 16 Pro"` or `--device <udid>`, from `list` or `devices`.
  `--emulator <id>` is an alternative spelling: the bridge resolves both through the same lookup. These
  selectors apply to the action verbs; `list` and `devices` take only `--worktree`, and
  `attach` names its device as a positional argument.
- `--worktree id:<fullWorktreeId>` or `--worktree active`. The full id is the exact
  `<repo-id>::<path>` value returned by `hive worktree list --json`; a bare repo id is not
  valid here.
- `--worktree all` drops worktree scoping on every verb, not only on listing, so a mutating
  command passed `all` runs unscoped. Use it only for listing.

## Constraints

- All coordinates are normalized 0..1 with a top-left origin, never pixels. Tap an `ax`
  element at its frame center: `x + width / 2`, `y + height / 2`.
- Prefer `tap` over `gesture` for a single tap. A separate gesture begin/end pair can be
  interpreted as a long press because of WebSocket overhead; `tap` sends the quick sequence.
- `type` sends US-ASCII only, and unsupported characters error rather than degrading.
- The pane and the CLI share one stream and one helper, so closing the pane can stop the
  stream.
- Run `kill` when you are done. A helper left running holds the device until HiveCode quits.
- The iOS backend drives private simulator APIs, so an Xcode update can change its behavior.

## Examples

```text
hive emulator list --json
hive emulator attach "iPhone 16 Pro" --json
hive emulator tap 0.5 0.8 --json
hive emulator type "user@example.com" --json
hive emulator button home --json
hive emulator ax --json
hive emulator exec --command "ca-debug blended on" --json
hive emulator kill --device "iPhone 16 Pro" --json
```

See also: `orca-emulator-android` for Android devices, `orca-cli` for terminals, worktrees,
and the built-in browser, and `computer-use` for desktop UI outside the simulator.
