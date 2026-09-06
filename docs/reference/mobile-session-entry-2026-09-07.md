# Android session entry and Agent selection verification — 2026-09-07

## Changes

- Session entry: show connection/tab-loading feedback before the first connection.
  Terminal content keeps a loading overlay until xterm reports its first rendered
  snapshot. A subsequent viewport re-init preserves the already visible surface.
- Terminal panes: create WebViews only when a tab is first visited; keep visited
  panes mounted when switching tabs. This avoids initializing every unseen xterm
  and GL surface at session entry.
- New-tab Agent options: folder workspaces resolve through `folderWorkspace.list`,
  then detect Agents on their actual local/SSH host. Missing workspaces fail rather
  than silently detecting Agents on a different host. Failed option loads can be
  retried without dismissing the sheet.
- Home Agent picker, selected composer Agent and review-note Agent actions reuse
  `MobileAgentIcon`. Pi now follows the current theme's foreground, matching the
  existing desktop SVG's currentColor treatment.

No new dependency, asset, design token, product edition or public configuration.
Existing theme, typography and spacing tokens are reused. No new design exception.

## Verification

- 25 focused tests passed: first-paint loading lifecycle, lazy WebView lifetime,
  Agent option discovery (including local/SSH folders and missing workspace),
  Agent theme icons and existing home behavior. Mobile TypeScript and targeted
  oxlint/format checks passed.
- Visible Android AVD `hivecode-crash-check`, installed code 19 development client,
  existing account retained. Changes loaded through Metro without APK rebuilding.
- Captured connecting → loading content → rendered session states.
- New Tab now lists enabled Agents with brand icons. Codex creation was exercised
  twice; the temporary test tabs were closed, leaving the original three tabs.
  No task prompt or CLI update was intentionally submitted.
- Light theme at 411dp/100%, dark theme at 360dp/130%: loading copy and Agent actions
  visible, brand icons readable, sheet actions fit/scroll above the bottom safe
  area. Keyboard opened without typing in the temporary session; the input dock
  remained above the keyboard. Original emulator density/font/night settings
  were restored after verification.
- Before lazy mounting, a native ANR trace showed main/RenderThread waiting in
  WebView GL drawing with substantial paging (not a JS busy loop). After the
  change, a three-tab entry reported one WebView; subsequent navigation and Agent
  creation completed without a new ANR in the observed event-log window.

## Limits

This is focused Android debug validation, not a release performance benchmark or
an iOS test. The previous ANR's exact Chromium/native cause is not proven resolved;
lazy mounting reduces simultaneous native allocation/drawing. The existing
preconnection command placeholder clips at 130% font scale; active keyboard input
and the changed loading/Agent controls remained usable. Unrelated Desktop edits
were not included in this commit.

Local screenshots/logs: `.tmp/session-connection-fix/ui-*.png`,
`ui-regression.log`, `android19-dropbox-anr.txt`. Visual verdict:
workspace `.omx/state/mobile-session-ui/ralph-progress.json`.
