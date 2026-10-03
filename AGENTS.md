# Single product implementation

HiveCode has no released users requiring old product compatibility. Ship one current
implementation and update all owned clients/services together. Do not retain old/new,
v1/v2, development/test product paths, compatibility fallbacks or opt-in feature gates
unless the user explicitly requests them. Remove superseded code and its UI/settings.
Protocol schema identifiers, cryptographic domains and third-party version requirements
are not product editions; keep their validation consistent across the current stack.
This user policy overrides historical mixed-version and legacy-preservation guidance.

# Design System

Internal documentation lives in the private `coder-lulu/hive-code-docs` repository,
mounted at `docs/` as a pinned Git submodule. Authorized developers can run
`git submodule update --init docs` to read the referenced guides. Push documentation
changes to the private repository before updating the public submodule reference.
Never copy internal document bodies into this public repository or build artifacts.
Public CI and client builds must work without initializing the documentation submodule.

## HiveCode APP UI

Any HiveCode APP/mobile UI work, including changes under `mobile/`, must first read and follow [`HiveCode-APP-UI-AI-Coding-Constraints.md`](./HiveCode-APP-UI-AI-Coding-Constraints.md) in full. It is the product-specific authority for APP layout, visual design, interaction, accessibility, implementation, and delivery. Accessibility and platform requirements remain the highest priority; for APP-specific decisions, this contract takes precedence over the generic desktop style guide. If a request conflicts with it, do not silently create another visual language: apply the contract where possible and report the conflict and resolution in the delivery notes.

HiveCode APP UI must follow the **Graphite Precision / 石墨精密工作台** contract:

1. Use graphite black, warm white, and cool gray as the visual base. Brand blue is limited to the Logo, focus, links, selected icons, and AI states; never use large blue surfaces, blue gradients/glows, or blue-outlined cards.
2. Business/page code must not hardcode colors, font sizes, spacing, radii, shadows, or other design constants. Use global semantic tokens; add a global token before using a missing value.
3. Use only the documented typography tokens: `30/38`, `20/28`, `16/24`, `15/22`, `14/20`, `13/18`, and `12/16`, normally with weights `400`, `500`, or `600`.
4. Use the 4dp grid and spacing tokens `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48`, and `64dp`. Default horizontal page padding is `20dp`, never below `16dp`.
5. Use only `4`, `8`, `12`, and `16dp` radii. Non-circular controls must not exceed `16dp`; pills are reserved for status labels, two-state segmented controls, and very short filters.
6. Settings and task items use grouped lists with dividers. Do not turn every row into an independent rounded card or add decoration without functional meaning.
7. Use one consistent linear icon system at `1.75–2dp` stroke width and `16`, `20`, or `24dp` sizes. Do not mix emoji, arbitrary Unicode symbols, filled icons, or mismatched stroke styles.
8. Primary actions use graphite black/inverse colors; brand blue is not the default primary-button color. The “云端工作 / 连接电脑” selected state uses black/white inversion.
9. The product name is always `HiveCode`; use “连接电脑”, never “链接电脑”; do not introduce `WorkBuddy`, `HvieCode`, or other naming variants.
10. Use the latest bee mascot only for the home Hero, AI empty states, onboarding, and key success feedback. Do not use it as decoration on settings, account, or legal pages, and never distort, recolor, crop, or outline brand assets.
11. New pages must support light/dark themes, safe areas, 100%–130% font scaling, keyboard avoidance, narrow/small screens, long text, reduced motion, and minimum `44×44dp` targets. State must never be communicated by color alone, and text contrast must meet WCAG AA.
12. Before coding, inspect and reuse existing themes, tokens, icons, and shared components in that order. Do not add a UI, font, or icon library without explicit authorization, duplicate equivalent components, use screenshot-matching absolute positioning, or push content with fixed blank space.
13. Interactive components must implement every applicable default, pressed, focused, disabled, loading, success, and error state. Standard transitions are `160–220ms`, up to `280ms` for complex drawers/sheets, and must respect reduced-motion settings.
14. UI delivery notes must list changed screens/components, token changes, documented exceptions, and verification results for light/dark themes, small screens, 130% font scaling, keyboard/safe-area behavior, accessibility, and primary interaction states. Do not report only “completed” or “optimized”.

## Shared and Desktop UI

Design system checks run through `pnpm run check:code-quality:changed`; `pnpm run lint:design-system` provides the full renderer report.

All non-APP UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.

## Electron UI Validation

Always run tests and agent-launched apps in the background with `ORCA_BACKGROUND_LAUNCH=1`.
Never steal monitor focus or reveal test windows: no `show()`, `showInactive()`, `bringToFront()`,
`app.focus()`, or OS activation. Use CDP screenshots of hidden renderers. Keep native-focus and
visible-window tests paused on the user's desktop; run them on an isolated display or CI.
Rebuild modified launch-policy code before running an app; stale build wrappers are not safe.

Use the `$electron` skill and Playwright CDP for rendered HiveCode UI checks. Do not use computer-use for HiveCode UI validation.

# Style

## Reuse Before Reimplementing

Before writing new logic at any scale — a function, component, IPC channel, state store, or whole subsystem/flow — check whether an existing implementation already does the job (or nearly does). Extend or generalize it instead of building a parallel version; only write from scratch when nothing fits. Keep the check proportionate: a quick search for trivial code, a real one before building anything substantial.

## Concise/Brief Non-obvious Comments ONLY

- DO NOT: be verbose, explain the obvious, walk through the code ("WHY not HOW")
- BE CONCISE. 1 LINE if possible

## Lint Rules: Do Not Disable Max Lines

NEVER add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Type Declarations: Prefer `.ts` Over `.d.ts`

# Generated Logs, Screenshots, and Temporary Files

- Store agent-generated test/build logs, screenshots, recordings, performance traces, test reports, and scratch files under the current project root's `logs/` directory. Never write these artifacts directly into the project root or its parent workspace root.
- Resolve the project root from the repository/worktree being worked on, not the shell's incidental working directory. Create `logs/` before writing; use task-specific subdirectories such as `logs/session-loading/`, with `screenshots/` and `tmp/` inside when useful.
- Set output paths explicitly for command redirection, screenshot tools, and test/report runners so their generated evidence stays under `logs/`. Keep the whole `/logs/` directory ignored by Git.
- Source files, product assets, required build outputs, and tool-owned runtime/state directories retain their prescribed locations. This rule applies to diagnostic evidence and disposable working files, not those files.

# Verifying Changes

- **Typecheck**: `pnpm tc` (or `tc:node` / `tc:cli` / `tc:web`)
- **Test**: `pnpm test [path/to/file.test.ts]`
- **Lint**: `oxlint`, or `pnpm run check:code-quality:changed` for changed files (full `pnpm lint` is slow); format with `pnpm format`
- **Design system**: `pnpm run lint:design-system` for the full renderer report (not a gate); the changed-lines gate above is what CI enforces
- **Real Claude CLI**: when you change Claude structured-session code (`src/main/claude/claude-structured-*`), run `ORCA_REAL_CLAUDE_CLI_TEST=1 pnpm test src/main/claude/claude-structured-real-cli.test.ts src/main/claude/claude-structured-real-cli-fold.test.ts`; it uses your real Claude login

# Writing Pull Requests

Fill in [`.github/pull_request_template.md`](./.github/pull_request_template.md), written for a reviewer who has never seen this code:

- No jargon — plain language, no internal shorthand.
- The before and after as the user experiences it.
- The mechanism you changed, not just the symptom.
- Why this approach over the alternatives you considered.

Cover all four concisely. Don't pad or walk the diff.

# Considerations

## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

HiveCode targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.
- **Windows terminal shells**: `--shell` picks the shell a terminal _is_; `--command` is typed into whatever shell the host spawned, so a shell choice routed through `command` silently becomes a child process. See [`docs/reference/windows-terminal-shell-selection.md`](./docs/reference/windows-terminal-shell-selection.md).
- **Windows setup scripts**: the setup/issue-command runner is a `.cmd` batch file unless the script starts with a `#!` line — never derive that from the user's terminal-shell preference, and never launch a `.cmd` runner with a bare `cmd.exe /c` from a Git Bash pane (MSYS rewrites the `/c`). See [`docs/reference/windows-setup-shell.md`](./docs/reference/windows-setup-shell.md).
- **Windows child processes**: start them through `runProcess`/`spawnProcess` in `src/shared/child-process/` — never `child_process` directly. It pins `windowsHide`, refuses `shell: true`, and encodes `.cmd`/`.bat` arguments so neither `CommandLineToArgvW` nor `cmd.exe` mangles them. A ratchet test fails on any new direct import. Recognised npm/pnpm `.cmd` shims are resolved to their real target so the spawn skips `cmd.exe` entirely; see [`docs/reference/windows-cmd-shim-resolution.md`](./docs/reference/windows-cmd-shim-resolution.md) before adding a shim shape or debugging one.
- **Ripgrep**: HiveCode bundles `rg` for every platform, WSL, and SSH remotes. Spawn it through `spawnBundledRipgrep` (main) or `resolveRelayRipgrepCommand` (relay), never a bare `'rg'` — Windows resolves a bare name in the spawn cwd before PATH. Don't add git/readdir fallbacks locally; the relay's chain exists only for hosts an upload never reached.
- **Windows process enumeration**: read the table through `src/main/windows/windows-process-table.ts`, never by forking `powershell.exe`. See [`docs/reference/windows-process-enumeration.md`](./docs/reference/windows-process-enumeration.md).
- **Windows MSYS/Git Bash panes**: their children break away from the per-PTY job unless it is created without `JOB_OBJECT_LIMIT_BREAKAWAY_OK`, and a `conpty.node` built before that fix passes every existing gate. Before changing the per-PTY job or debugging `windows-msys-job.win32.test.ts`, read [`docs/reference/windows-msys-job-breakaway.md`](./docs/reference/windows-msys-job-breakaway.md).
- **Windows daemon-host relocation**: the terminal daemon runs from a copy of the app runtime under `%LOCALAPPDATA%`, which is what survives an auto-update. Before touching that copy, its exe name, or the NSIS uninstall macro, read [`docs/reference/windows-daemon-host-relocation.md`](./docs/reference/windows-daemon-host-relocation.md).
- **Windows EDR signal**: don't add `-ExecutionPolicy Bypass`, `-EncodedCommand`, `cmd.exe /c` with escaped free text, per-operation interpreter spawning, or runtime `Add-Type` compilation without reading [`docs/reference/windows-edr-posture.md`](./docs/reference/windows-edr-posture.md) first — behavioural EDR scores each of those, and being signed does not clear them. For file verdicts on the bytes we ship — antivirus false positives, and the vendor programs that clear a release before users meet the detection — see [`docs/reference/antivirus-prerelease-clearance.md`](./docs/reference/antivirus-prerelease-clearance.md).
- **WSL commands**: build argv with `buildWslExecArgs` (always `--exec` — under `--`, `wsl.exe` expands `$name` in every argument and silently rewrites the script), and fence anything whose stdout you parse with `buildWslCapturedLoginShellCommand`, because the interactive login shell prints the distro banner to stdout. See [`docs/reference/wsl-command-execution.md`](./docs/reference/wsl-command-execution.md).
- **Linux native modules**: keep the glibc floor at Ubuntu 20.04 / glibc 2.31. A module compiled from source on a newer runner can reference symbol versions absent on the floor and crash the app on startup. See [`docs/reference/linux-glibc-compatibility.md`](./docs/reference/linux-glibc-compatibility.md); packaging fails if a bundled native binary needs newer glibc.

## Native Dependency Installs

Ordinary `pnpm install` covers the host OS and CPU only. Before packaging for another architecture — including `pnpm build:mac`, which builds x64 and arm64 by default — run `pnpm install:release`. electron-builder only warns on a missing `extraResources` source, so the `beforePack` guard is what turns a thin install into a build failure instead of a silently broken artifact; see [`docs/reference/pnpm-install-policy.md`](./docs/reference/pnpm-install-policy.md).

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution. Before changing anything that reports on, stops, or lists remote work, follow [`docs/reference/ssh-execution-boundary.md`](./docs/reference/ssh-execution-boundary.md): the execution host owns everything that touches execution, and loss of contact is never evidence of process death — the verdict vocabulary is `live` / `unverifiable` / `exited`, with no synonyms.

## Folder Workspace Use Case

All changes must consider folder workspaces as well as git worktrees. Don't assume every workspace is a git worktree.

## Agent Status

The execution host owns agent status in one store, the hook server's, and every reader (sidebar, `worktree ps`, mobile, dashboard) subscribes to it. Before adding a producer, a cache, or a reader-side precedence rule, read [`docs/reference/agent-status-store.md`](./docs/reference/agent-status-store.md): new producers write into that store, and readers keep only presentation policy.

## Agent Terminal Screens

A rule that reads what an agent CLI paints on a terminal — readiness, blocked prompts, idle — must be written against a captured transcript, not a remembered screen. Record one with [`docs/reference/agent-pty-transcript-capture.md`](./docs/reference/agent-pty-transcript-capture.md), which keeps escapes and wrapping intact and scrubs account identifiers before they reach git. Antigravity readiness has no transcript yet and five failed attempts without one; before touching it, read [`docs/reference/antigravity-readiness-evidence.md`](./docs/reference/antigravity-readiness-evidence.md).

## Remote Wire Compatibility

Update owned clients and servers together against one current wire contract. Validate
RPC, stream and authentication boundaries without adding a second legacy implementation.
Historical [`remote-wire-compatibility.md`](./docs/reference/remote-wire-compatibility.md)
does not authorize mixed-version product support; that requires an explicit user request.

## Git Binary Compatibility

HiveCode runs the user's Git binary on native, WSL, and SSH hosts, which may all have different versions. Treat Git 2.25 as the core-workflow baseline and follow [`docs/reference/git-compatibility.md`](./docs/reference/git-compatibility.md).

When adding or changing a Git command:

- Check when every subcommand and option was introduced. For newer behavior, keep a baseline-compatible fallback or degrade safely.
- Use `GitCapabilityCache` with a narrow unsupported-error predicate so recurring operations do not retry a known-invalid command. Do not rely only on `git --version`; wrappers such as `simple-git` do not remove host-version differences.
- Scope capability state to the host that executes Git: native, WSL distro, SSH provider, or relay connection. Cover the first fallback, later cached calls, concurrent probes, and relevant host isolation in tests.
- Keep the real-binary compatibility contract in PR CI current. When adopting a newer Git feature, add its version boundary so the preferred command and fallback both run against representative Git releases.
- Preserve commands that begin with global Git options such as `-c` before the subcommand, including auto-maintenance suppression used by worktree-create fetches.

## Git Scan Safety

- Never enumerate every ref and then run `git ls-tree -r` or `git show` once per ref. That ref × tree fan-out can retain gigabytes of output before a downstream `sort -u` or search can make progress.
- Prefer `rg` over the checked-out files for source searches. For history or refs, use a named ref, an explicit namespace/path, `--max-count`, and a bounded output; do not use an unqualified `--all` scan as a first diagnostic.
- Keep repository-wide commands targeted to the current repository and worktree. If an unbounded scan is genuinely required, measure the ref count first, explain the cost, and get confirmation before running it.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.
