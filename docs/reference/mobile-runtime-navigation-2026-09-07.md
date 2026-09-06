# Mobile Runtime navigation and creation controls

## Changes

- New Tab uses a fixed content height (60% of the window, capped by safe areas),
  a pinned heading and a separate scrollable action list with a scrollbar.
- Home displays the selected Runtime name. Workspace and task-center primary
  Tasks navigation returns to Home; the task center retains its drawer entry.
- Run on labels local checkouts with the connected computer name and offers the
  account Runtime selector. Changing computers opens a fresh creation route;
  project IDs from the previous computer are not reused.
- Picker selection waits for the actual drawer close animation. External
  cancellation discards pending selection, and late dismiss events cannot
  overwrite the next drawer.
- Creation form, SSH and setup controls reuse the existing dynamic theme styles.
  Deleted the duplicate static form styles. No new dependency or product mode.
- Desktop account Relay dispatch now passes the authenticated RuntimeSession into
  both unary and streaming RPC contexts. Worktree and folder-workspace creation
  record `account-runtime` provenance; stored metadata preserves that source.
  This fixes `authenticated_device_identity_missing` without inventing a paired
  device or treating a remote request as a local host request.

Files are under `mobile/src/components`, `home`, `host-screen`, `session`,
`tasks` and `theme`. The only new theme token is
`size.actionSheetHeightRatio = 0.6`; it centralizes the requested fixed sheet
height. Existing semantic colors and control sizes cover the remaining changes.

## Verification

- Seven focused test files: 28 tests passed. Mobile TypeScript, targeted lint and
  formatting passed. Coverage includes theme contrast tokens, Runtime selection,
  fresh form state, navigation, and cancellation during picker dismissal.
- Desktop identity: 24 focused tests passed, including real RPC dispatch,
  account creation, forged/missing identity rejection, expired sessions, and
  existing host/paired callers. Node TypeScript passed.
- Visible Android emulator, existing authenticated account, code 19 client with
  Metro updates. Home shows the selected computer; Workspace → Tasks returns to
  Home. Run on shows DESKTOP-UL1DAG2 and opens the account computer selector.
- Light and dark creation forms inspected: headings, Agent dropdown, icons and
  submit foreground/background now follow the active theme.
- New Tab screenshots before/after Agent discovery show identical sheet height
  and an overflow scrollbar. End-to-end scrolling was interrupted by a native
  ANR and is not claimed as fully verified here.

## Remaining limits and evidence

Only one account Runtime is available, so cross-computer creation is covered by
logic tests rather than a two-computer live test. iOS and release performance
benchmarks were not run.

The emulator reproduced an ANR: main waits in
`ThreadedRenderer_syncAndDrawFrame`, RenderThread waits inside Trichrome through
`WebViewFunctor::drawGl`. This is not evidence that the precise native cause is
fixed. Keep it separate from navigation and theme validation. The identity fix
requires installing and restarting the updated Desktop; a live create operation
against the updated running Desktop has not yet been verified.

Local evidence: `.tmp/session-connection-fix/{sheet-ready,home-return,run-target,
form-dark,form-dark-verified}.png` and `navigation-anr-trace03.txt`.
