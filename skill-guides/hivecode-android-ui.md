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

# HiveCode Android UI workflow

Use this skill for the complete Android UI loop in the HiveCode repository:
inspect the existing mobile implementation, start or attach an emulator, run the
Expo client and its desktop/mock transport, implement a focused visual change,
then verify the result with screenshots, accessibility output, and tests. Keep
the application behaviour, navigation, pairing, authentication, WebSocket RPC,
and terminal interactions intact unless the request explicitly changes them.

## Scope and first inspection

Work from the repository root unless a command says otherwise. Before editing,
read these files and the target screen/component:

```text
mobile/README.md
mobile/package.json
mobile/app.json
mobile/app/                 # Expo Router screens
mobile/src/                 # components, theme, transport, state
mobile/assets/              # mascots, icons, splash artwork
```

Search for the route, existing theme/provider, navigation callbacks, and the
data source that drives the screen. Reuse existing tokens and icon libraries;
do not add a dependency for a visual-only change. Capture the current screen
before changing it so a regression can be distinguished from the requested
redesign.

Treat the supplied screenshot/spec as the source of truth for the requested
region only. Preserve unrelated regions and business logic. Do not “fix” a
desktop or iOS layout while working on an Android-only request.

## Choose the device control path

For HiveCode-managed device control, load the version-matched guide before
guessing commands:

```text
hive skills get orca-emulator-android
hive emulator devices --json
```

Use `hive` in current builds. If the compatibility environment variable
`ORCA_CLI_COMMAND` is set, use its pinned executable instead. Older builds may
expose `orca-dev`, `orca-ide`, or `orca`; use one only when `hive` is unavailable.
Use the device serial reported by discovery; never infer one from an AVD name.
HiveCode coordinates are normalized 0..1, while direct adb commands use physical
pixels.

If the HiveCode CLI is unavailable, use the Windows SDK fallback below. This is
also the reliable path for the local Windows Android test setup.

## Start or attach an Android emulator (Windows fallback)

Do not assume that `emulator-5554` exists. Resolve the SDK and inspect the
available devices first:

```powershell
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
$emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
if (-not (Test-Path $adb)) { throw "adb not found at $adb; install Android SDK platform-tools or set ANDROID_HOME." }
& $adb start-server
& $adb devices -l
& $emulator -list-avds
```

If no device is listed as `device`, select an AVD name from the actual
`-list-avds` output and launch it visibly so it can be inspected:

```powershell
$avdName = '<AVD name from emulator -list-avds>'
Start-Process -FilePath $emulator -ArgumentList @('-avd', $avdName)
& $adb wait-for-device
$deadline = (Get-Date).AddSeconds(120)
do {
  $booted = ((& $adb shell getprop sys.boot_completed 2>$null) -join '').Trim() -eq '1'
  if (-not $booted) { Start-Sleep -Seconds 2 }
} while (-not $booted -and (Get-Date) -lt $deadline)
if (-not $booted) { throw 'Android emulator did not finish booting within 120 seconds.' }
& $adb devices -l
```

Use the serial printed by the final command in every later adb call. If more
than one device is connected, pass `-s <serial>`; do not send input to an
unspecified device. A physical phone is acceptable only when USB debugging is
explicitly in scope.

## Start the app and its transport

The mobile app is an Expo Router client. Run these in separate terminals:

```powershell
# repository root: desktop RPC, only when the real desktop is needed
pnpm install
pnpm dev

# mobile directory: Metro/Expo
cd mobile
pnpm install
pnpm start
```

For deterministic UI work without a desktop runtime, use the mobile mock server
instead of inventing fixtures:

```powershell
cd mobile
pnpm mock-server                 # default WebSocket port 6768
```

Android's host loopback is `10.0.2.2`, so the emulator endpoint is normally
`ws://10.0.2.2:6768`; a physical phone needs the desktop LAN address. Check the
current pairing/configuration and Metro logs rather than hard-coding a port: in
some live sessions the app has used `6769` while the mock server defaults to
`6768`.

The package declared by `mobile/app.json` is
`com.hivekernel.hivecode.mobile`. After a dev-client/native build is installed,
restart it with the discovered serial:

```powershell
$serial = '<serial from adb devices -l>'
& $adb -s $serial shell am force-stop com.hivekernel.hivecode.mobile
& $adb -s $serial shell monkey -p com.hivekernel.hivecode.mobile 1
```

Use `pnpm android` (`expo run:android`) when the native client is not installed
or native configuration changed. `mobile/scripts/start-emulator.mjs` is an
iOS/Xcode automation script despite its name; do not use it as the Android
startup path.

On a cold launch, allow roughly 15–20 seconds for Metro, the dev client, and
the WebSocket handshake. A blank frame during the first few seconds is not
evidence of a rendering bug; inspect logcat after the app settles.

## Implementing an Android UI redesign

- Identify the smallest screen/component and edit only that surface. Keep
  navigation actions, selectors, async states, permissions, transport calls,
  and test IDs stable unless the request requires a behaviour change.
- Follow the existing theme provider and semantic tokens. For Graphite
  Precision/light designs, use warm white, graphite, and cool-gray surfaces;
  reserve brand blue for identity/focus feedback and status colors for state.
  Do not introduce a second theme system or hard-code a one-off palette in a
  business component.
- Preserve exact product copy supplied by the request. Check Chinese text for
  spelling, line wrapping, truncation, and font scaling at 100% and 130%.
- Keep every interactive target at least 44dp, provide a visible pressed,
  focused, disabled, and loading state, and expose a meaningful accessibility
  label. Visual hierarchy must not rely on color alone.
- Prefer the project's existing `lucide-react-native` (or established local
  icon set) with one consistent stroke weight. Do not substitute emoji or
  platform-colored social icons for a precision UI.
- For horizontal shortcut rows, keep the requested order and semantics. Use a
  single horizontal scroll container when the design allows it; do not force
  cards to stretch or overflow the viewport. Verify the actual physical swipe
  row on the emulator after editing.
- For mascot or raster art, inspect the source alpha channel first. Do not hide
  a baked checkerboard with a CSS color. If extraction is needed, use a
  deterministic asset transform that preserves the subject, dimensions, and
  transparent edges, then commit the generated asset alongside its source.

## Restart, inspect, and capture evidence

Run the capture commands from the repository root (`cd ..` if the previous
Metro/mock-server command left the shell in `mobile/`) so the evidence paths
land under the shared `.omx/logs` directory:

```powershell
& $adb -s $serial shell screencap -p /sdcard/hivecode-ui.png
& $adb -s $serial pull /sdcard/hivecode-ui.png .omx/logs/hivecode-android-ui.png

& $adb -s $serial shell uiautomator dump /sdcard/hivecode-ui.xml
& $adb -s $serial shell cat /sdcard/hivecode-ui.xml

& $adb -s $serial shell logcat -d -t 250 |
  Select-String 'FATAL EXCEPTION|Render Error|ReactNativeJS|useMobileTheme|WebSocket'
```

Prefer a clean force-stop/relaunch before each comparison. Inspect the pulled
image with the image viewer, compare it to the reference, and record a visual
verdict in `.omx/state/<scope>/ralph-progress.json` when the project visual QA
workflow is active. A useful verdict checks category match, spacing, clipping,
contrast, state feedback, and whether unrelated regions stayed unchanged.

Use the accessibility dump to confirm that important labels, buttons, links,
and scroll containers exist and are not clipped. Exercise at least one happy
path and one state transition (for example open/close, loading/error, pair,
or shortcut swipe), not just the initial screenshot.

## Verification gates

Run the narrowest relevant checks first, then the full mobile suite when the
screen or shared theme changed:

```powershell
cd mobile
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

From the repository root, run the project checks required by the diff (at a
minimum `pnpm typecheck:node` when desktop-facing code or shared scripts were
touched). Re-run the emulator screenshot and accessibility checks after tests;
passing tests do not prove visual fidelity.

Report changed files, emulator serial/AVD, exact run commands, screenshot path,
test results, and any unverified native-device or network conditions. Do not
claim completion while the app still has a persistent logcat exception, an
unverified endpoint, clipped text, or a stale generated skill artifact.

## Recovery notes

- **Blank screen after launch:** wait for the cold Metro/dev-client startup,
  then force-stop/relaunch. If a `useMobileTheme must be used within
  MobileThemeProvider` error appears only during Fast Refresh, treat it as a
  transient reload and confirm it disappears after a clean launch; persistent
  occurrences require fixing provider order.
- **No device:** verify SDK paths, `adb devices -l`, AVD boot completion, and
  that no second adb server is shadowing the selected SDK. Never delete AVDs or
  reset app data as a first response.
- **Transport unavailable:** verify the desktop/mock process, the endpoint from
  current logs, and Android's `10.0.2.2` mapping before changing UI code.
- **Screenshot looks stale:** force-stop the package, relaunch, wait for the
  WebSocket/Metro settle, then capture again. Do not trust a frame taken during
  Fast Refresh.
- **HiveCode command mismatch:** use the exact executable's `skills get` guide and
  `--json` discovery output. Do not switch executables after an arbitrary error
  or guess undocumented flags.

See also: `orca-emulator-android` for the complete HiveCode Android command
surface, and `orca-cli` for HiveCode-managed terminal/worktree operations.
