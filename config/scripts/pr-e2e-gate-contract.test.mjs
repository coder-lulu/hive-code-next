import { linuxInstallPackageList } from './pr-e2e-linux-packages.test-fixture.mjs'
import { parse as parseJsonc } from 'jsonc-parser'
import {
  EXPECTED_NATIVE_IME_TESTS,
  IME_ENGAGEMENT_RECEIPT_ENV
} from './terminal-ime-engagement-receipt.mjs'
import { DEDICATED_E2E_SPECS } from './ci-e2e-job-selection.mjs'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  hasNativeImeSourceChange,
  NATIVE_IME_SOURCE_ROUTE_IDS,
  PR_E2E_SOURCE_ROUTES,
  selectPrE2eSpecs
} from './pr-e2e-source-routing.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const prWorkflow = parseYaml(readFileSync(join(projectDir, '.github/workflows/pr.yml'), 'utf8'))

const filterStep = prWorkflow.jobs.code_paths.steps.find(
  (step) => step.name === 'Filter changed E2E specs'
)
const rollbackStep = prWorkflow.jobs.preflight.steps.find(
  (step) => step.name === 'Check VM runtime rollback compatibility'
)
/** The route that sends a change to the two-Electron restart-survival spec. */
const restartSurvivalRoute = PR_E2E_SOURCE_ROUTES.find(
  (route) => route.id === 'client-hosted-browser.restart-survival'
)

describe('restart-survival E2E routing', () => {
  // Every file below carries behavior the restart spec is the only test that exercises end to end.
  it.each([
    'src/main/runtime/orca-runtime.ts',
    'src/main/runtime/browser/browser-commands.ts',
    'src/main/runtime/client-hosted-page-reconciliation-window.ts',
    'src/main/runtime/runtime-browser-client-page-adoption.ts',
    'src/main/runtime/runtime-browser-client-page-recovery.ts',
    'src/main/runtime/browser-host-client-page-adoption.ts',
    'src/main/runtime/browser-host-page-reconciliation-orchestration.ts',
    'src/main/runtime/rpc/methods/browser-client-host.ts',
    'src/main/browser/browser-client-host-authority-replacement-wait.ts',
    'src/main/browser/paired-runtime-browser-client-host-composition.ts',
    'src/renderer/src/runtime/web-session-tabs-sync/snapshot-api.ts',
    'src/renderer/src/runtime/host-session-snapshot-authority.ts',
    'src/renderer/src/runtime/restored-client-hosted-browser-host-attach.ts',
    'src/renderer/src/store/slices/runtime-status.ts',
    'src/shared/runtime-types.ts',
    'src/shared/browser-client-host-protocol.ts'
  ])('routes %s', (path) => {
    expect(restartSurvivalRoute.matches(path)).toBe(true)
    if (path === 'src/main/runtime/browser/browser-commands.ts') {
      expect(existsSync(join(projectDir, path))).toBe(true)
    }
  })

  // The pattern is deliberately not "anything under src": routing every PR at a two-Electron spec
  // is the cost the filter exists to avoid.
  it.each([
    'src/main/git/git-status.ts',
    'src/renderer/src/components/tab-bar/BrowserTab.tsx',
    'src/main/terminal/pty-manager.ts',
    // The status/types entries name whole files, not a suffix any longer name may end with.
    'src/shared/computer-use-runtime-types.ts',
    'src/main/runtime/browser/browser-commands.test.ts',
    'src/main/runtime/browser/browser-commands.test-fixture.ts',
    'src/main/runtime/browser/browser-commands.fixture.ts',
    'src/main/runtime/browser/browser-commands-extra.ts',
    'src/main/runtime/browser/browser-navigation.ts'
  ])('does not route %s', (path) => {
    expect(restartSurvivalRoute.matches(path)).toBe(false)
  })
})

describe('PR E2E gate contract', () => {
  it('selects modified Playwright specs without running deleted tests', () => {
    expect(filterStep.run).toContain('--diff-filter=AMCR')
    expect(filterStep.run).toContain('config/scripts/pr-e2e-source-routing.mjs')
    expect(filterStep.run).not.toContain('tests/playwright\\.')
    expect(
      selectPrE2eSpecs([
        'tests/e2e/active-view-restart-restore.spec.ts',
        'tests/e2e/deleted.spec.ts.bak',
        'tests/e2e/global-teardown.unit.test.ts'
      ])
    ).toEqual(['tests/e2e/active-view-restart-restore.spec.ts'])
  })

  it('scopes the VM rollback oracle to the PR range and recipe schema authorities', () => {
    expect(rollbackStep.run).toMatch(/diff-base\.mjs "\$BASE_SHA"[\s\S]*"\$DIFF_BASE" HEAD --/)
    expect(rollbackStep.run).toContain('src/shared/ephemeral-vm-recipes.ts')
    expect(rollbackStep.run).toContain('src/shared/orca-yaml-hook-types.ts')
  })

  it('routes P0 sentinels from their causal sources', () => {
    const cases = [
      [
        'src/renderer/src/components/tab-bar/TabBarQuickCommandsMenu.tsx',
        'tests/e2e/terminal-quick-command-pre-bind-recovery.spec.ts'
      ],
      ['src/main/runtime/orca-runtime-files.ts', 'tests/e2e/paired-quick-open-large-tree.spec.ts'],
      [
        'src/renderer/src/runtime/sync-runtime-graph.ts',
        'tests/e2e/host-parked-pane-remote-viewer.spec.ts'
      ],
      [
        'src/renderer/src/runtime/remote-runtime-terminal-multiplexer.ts',
        'tests/e2e/paired-remote-terminal-materialization-reconnect.spec.ts'
      ],
      [
        'src/renderer/src/components/terminal-pane/remote-pane-layout-push.ts',
        'tests/e2e/paired-remote-pane-layout-retry.spec.ts'
      ]
    ]
    for (const [source, spec] of cases) {
      expect(selectPrE2eSpecs([source]), source).toEqual([spec])
      expect(selectPrE2eSpecs([source.replace(/\.tsx?$/, '.test.ts')]), source).toEqual([])
      expect(existsSync(join(projectDir, spec)), spec).toBe(true)
    }
    const parkedSplitSpec = 'tests/e2e/terminal-parked-cli-split.spec.ts'
    for (const source of [
      'src/main/window/attach-main-window-services.ts',
      'src/preload/api/ui-command-event-api.ts',
      'src/preload/index.ts',
      'src/renderer/src/components/terminal-pane/terminal-pane-split-request-routing.ts',
      'src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts',
      'src/renderer/src/components/terminal-pane/use-terminal-tab-cold-parking.ts',
      'src/renderer/src/hooks/ipc-events/terminal-ui-routing-ipc-bridge.ts'
    ]) {
      expect(selectPrE2eSpecs([source]), source).toContain(parkedSplitSpec)
      expect(selectPrE2eSpecs([source.replace(/\.ts$/, '.test.ts')]), source).not.toContain(
        parkedSplitSpec
      )
    }
    expect(existsSync(join(projectDir, parkedSplitSpec)), parkedSplitSpec).toBe(true)

    const restartContinuitySpec = 'tests/e2e/paired-remote-terminal-serve-restart-binding.spec.ts'
    for (const source of [
      'src/main/daemon/daemon-attach-only-retirement.ts',
      'src/main/daemon/daemon-pty-applied-size.ts',
      'src/main/daemon/daemon-pty-session-control.ts',
      'src/main/daemon/daemon-pty-spawn-result.ts',
      'src/renderer/src/components/terminal-pane/remote-runtime-pty-transport.ts',
      'src/renderer/src/components/terminal-pane/terminal-error-accumulation.ts',
      'src/renderer/src/runtime/web-runtime-terminal-creation.ts',
      'src/renderer/src/runtime/web-runtime-session-tab-lifecycle.ts',
      'src/renderer/src/runtime/web-session-tabs-sync/use-web-session-tabs-sync.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-adoption.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-surface.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-inventory.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-inventory-validation.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-cache.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-pane.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-queue.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-recovery-rpc-lane.ts',
      'src/renderer/src/runtime/web-session-terminal-orphan-topology.ts'
    ]) {
      expect(selectPrE2eSpecs([source]), source).toContain(restartContinuitySpec)
      expect(selectPrE2eSpecs([source.replace(/\.ts$/, '.test.ts')]), source).not.toContain(
        restartContinuitySpec
      )
    }
    expect(existsSync(join(projectDir, restartContinuitySpec)), restartContinuitySpec).toBe(true)
    const quickCommandSpec = 'tests/e2e/terminal-quick-command-pre-bind-recovery.spec.ts'
    for (const source of [
      'src/renderer/src/components/terminal-pane/pty-connection.ts',
      'src/renderer/src/components/terminal-pane/pty-connection/connect-pane-pty.ts',
      'src/renderer/src/components/terminal-pane/pty-connection/fresh-spawn-start.ts',
      'src/renderer/src/components/terminal-pane/pty-connection/pane-pty-visibility-bind.ts',
      'src/renderer/src/components/terminal-pane/pty-connection/pty-input-recovery.ts'
    ]) {
      expect(selectPrE2eSpecs([source]), source).toContain(quickCommandSpec)
      expect(selectPrE2eSpecs([source.replace(/\.ts$/, '.test.ts')]), source).not.toContain(
        quickCommandSpec
      )
    }
    for (const source of [
      'src/main/ripgrep/bundled-ripgrep-path.ts',
      'src/shared/bundled-ripgrep.ts',
      'src/shared/ripgrep-process-availability.ts'
    ]) {
      expect(selectPrE2eSpecs([source]), source).toEqual([
        'tests/e2e/paired-quick-open-large-tree.spec.ts'
      ])
    }
    expect(
      selectPrE2eSpecs([
        'src/main/runtime/orca-runtime-files.ts',
        'tests/e2e/paired-quick-open-large-tree.spec.ts'
      ])
    ).toEqual(['tests/e2e/paired-quick-open-large-tree.spec.ts'])
    expect(selectPrE2eSpecs(['src/renderer/src/components/FileExplorer.tsx'])).toEqual([])
    expect(
      selectPrE2eSpecs([
        'src/renderer/src/components/terminal-pane/remote-runtime-pty-transport.ts'
      ])
    ).toContain('tests/e2e/paired-remote-terminal-materialization-reconnect.spec.ts')
    expect(
      selectPrE2eSpecs([
        'src/renderer/src/components/terminal-pane/remote-runtime-pty-transport-test-harness.ts'
      ])
    ).not.toContain('tests/e2e/paired-remote-terminal-materialization-reconnect.spec.ts')
    expect(selectPrE2eSpecs(['src/main/ipc/pty/register-handlers.ts'])).not.toContain(
      'tests/e2e/paired-remote-terminal-materialization-reconnect.spec.ts'
    )
  })

  it('triggers the real-IME lane from every surface an input method can judge', () => {
    for (const file of [
      'src/renderer/src/components/terminal-pane/terminal-ime-composition-route.ts',
      'src/renderer/src/components/terminal-pane/terminal-ime-native-text-forwarder.ts',
      'src/renderer/src/components/terminal-pane/terminal-ios-hangul-preedit.ts',
      'src/renderer/src/components/terminal-pane/xterm-bypass-policy.ts',
      'src/renderer/src/lib/pane-manager/terminal-ime-anchor.ts',
      'src/shared/terminal-unicode-provider.ts',
      // The xterm fork owns the helper textarea the IME attaches to; no file here says "ime".
      'config/patches/@xterm__xterm@6.1.0-beta.304.patch',
      'config/patches/xterm-src/@xterm__xterm@6.1.0-beta.304.src.patch',
      // The harness is source too: breaking the runner or a probe is how the lane goes blind.
      'config/scripts/run-terminal-ibus-hangul-e2e.mjs',
      'config/scripts/terminal-ime-engagement-receipt.mjs',
      'tests/e2e/terminal-ime-boundary-probe.ts',
      'tests/e2e/terminal-ime-byte-reader.ts',
      'tests/e2e/terminal-ime-engagement-receipt.ts',
      'tests/e2e/terminal-ibus-hangul-native.spec.ts'
    ]) {
      expect(hasNativeImeSourceChange([file]), file).toBe(true)
    }

    // Why: a real ibus session on a Git or tab-bar edit is the cost the filter exists to avoid,
    // and a unit test beside the source must not summon a three-and-a-half-minute lane.
    for (const file of [
      'src/main/git/git-status.ts',
      'src/renderer/src/components/tab-bar/BrowserTab.tsx',
      'src/main/terminal/pty-manager.ts',
      'docs/STYLEGUIDE.md',
      'src/renderer/src/components/terminal-pane/terminal-ime-composition-route.test.ts',
      'src/renderer/src/lib/pane-manager/terminal-ime-anchor.test.ts'
    ]) {
      expect(hasNativeImeSourceChange([file]), file).toBe(false)
    }
  })

  it('routes only core xterm patches to both IME lanes across version updates', () => {
    for (const file of [
      'config/patches/@xterm__xterm@6.1.0-beta.304.patch',
      'config/patches/xterm-src/@xterm__xterm@6.1.0-beta.304.src.patch',
      'config/patches/@xterm__xterm@7.0.0.patch',
      'config/patches/xterm-src/@xterm__xterm@7.0.0.src.patch'
    ]) {
      const specs = selectPrE2eSpecs([file])
      expect(hasNativeImeSourceChange([file]), file).toBe(true)
      expect(specs, file).toContain('tests/e2e/terminal-ime-exact-byte.spec.ts')
      expect(specs, file).toContain('tests/e2e/terminal-ibus-hangul-native.spec.ts')
    }
    for (const file of [
      'config/patches/i18next-cli@1.74.2.patch',
      'config/patches/node-pty@1.1.0.patch',
      'config/patches/monaco-editor@0.55.1.patch',
      'config/patches/@xterm__addon-webgl@0.20.0-beta.300.patch',
      'config/patches/xterm-src/@xterm__addon-search@0.17.0-beta.301.src.patch',
      'config/patches/xterm-upstream.json',
      'config/patches/@xterm__xterm@7.0.0.patch.bak'
    ]) {
      expect(hasNativeImeSourceChange([file]), file).toBe(false)
      expect(selectPrE2eSpecs([file]), file).toEqual([])
    }
    const corePatch = 'config/patches/@xterm__xterm@6.1.0-beta.304.patch'
    const mixedChanges = ['config/patches/i18next-cli@1.74.2.patch', corePatch]
    expect(hasNativeImeSourceChange(mixedChanges)).toBe(true)
    expect(selectPrE2eSpecs(mixedChanges)).toEqual(selectPrE2eSpecs([corePatch]))
  })

  it('keeps the native IME spec out of the lane that would silently skip it', () => {
    expect(DEDICATED_E2E_SPECS).toContain('tests/e2e/terminal-ibus-hangul-native.spec.ts')
    // Why it still has to be routed: the dedicated lane is selected by the same route, so the
    // spec appearing in test_files is how a spec-only edit reaches the real-IME lane at all.
    expect(selectPrE2eSpecs(['src/shared/terminal-unicode-provider.ts'])).toContain(
      'tests/e2e/terminal-ibus-hangul-native.spec.ts'
    )
  })
})

describe('Daemon mock modified-only source routing', () => {
  const helper = 'src/main/daemon/daemon-init-dependency-mocks.ts'
  const verified = { allowDaemonInitTestSupport: true }
  it('omits the real D7 route only for the proven unit-support scope', () => {
    expect(selectPrE2eSpecs([helper])).toContain('tests/e2e/orcad-serve-mode-switch.spec.ts')
    expect(selectPrE2eSpecs([helper], undefined, verified)).toEqual([])
    const companion = 'src/main/codex/codex-app-server-connection.test.ts'
    expect(selectPrE2eSpecs([helper, companion], undefined, verified)).toEqual(
      selectPrE2eSpecs([companion])
    )
  })
  it.each([
    { files: [] },
    { files: [helper, 'src/main/daemon/daemon-init.ts'] },
    { files: [helper, 'package.json'] },
    { files: [helper, 'src/main/daemon/unknown-support.ts'] },
    { files: [helper, helper] }
  ])('retains existing routes for an uncertain or mixed vector $files', ({ files }) => {
    expect(selectPrE2eSpecs(files, undefined, verified)).toEqual(selectPrE2eSpecs(files))
  })
})

const verifyStep = prWorkflow.jobs.verify.steps.find(
  (step) => step.name === 'Require successful checks'
)
const reliabilityManifest = parseJsonc(
  readFileSync(join(projectDir, 'config/reliability-gates.jsonc'), 'utf8')
)
const nativeImeWorkflow = parseYaml(
  readFileSync(join(projectDir, '.github/workflows/terminal-ime-e2e.yml'), 'utf8')
)
const nativeImeRunner = readFileSync(
  join(projectDir, 'config/scripts/run-terminal-ibus-hangul-e2e.mjs'),
  'utf8'
)
const nativeImeSpec = readFileSync(
  join(projectDir, 'tests/e2e/terminal-ibus-hangul-native.spec.ts'),
  'utf8'
)
describe('Hive owned PR gate safety', () => {
  it('keeps E2E advisory while the suite is red on main', () => {
    // Why: pin the deliberate choice so it reads as intentional rather than as
    // the "forgot to wire the gate" bug this file originally caught. Gating on a
    // suite that fails every scheduled run would block the PRs that fix it.
    // Flipping to blocking means updating this expectation too — see the comment
    // on verify's Require-successful-checks step for the exact wiring.
    expect(prWorkflow.jobs.verify.needs).not.toContain('e2e')
    expect(verifyStep.env.E2E).toBeUndefined()
    expect(verifyStep.run).not.toContain('$E2E')
  })
  it('passes only changed specs to the reusable E2E workflow', () => {
    // Why: without this the job could lose its filter and run on every PR — the
    // cost the path filter exists to avoid — while the gate assertions above
    // stay green.
    expect(prWorkflow.jobs.e2e.needs).toEqual(['code_paths', 'preflight'])
    expect(prWorkflow.jobs.e2e.if).toContain("needs.code_paths.outputs.e2e_should_run == 'true'")
    expect(prWorkflow.jobs.code_paths.outputs.e2e_should_run).toBe(
      '${{ steps.e2e_filter.outputs.should_run }}'
    )
    expect(prWorkflow.jobs.code_paths.outputs.test_files).toBe(
      '${{ steps.e2e_filter.outputs.test_files }}'
    )
    expect(prWorkflow.jobs.e2e.with.ref).toBe('${{ github.event.pull_request.head.sha }}')
    expect(prWorkflow.jobs.e2e.with.test_files).toBe('${{ needs.code_paths.outputs.test_files }}')
  })
  it('enforces every job verify depends on', () => {
    // Why: derive from verify.needs rather than hardcoding, so adding a required
    // job without adding it to the strict loop fails here instead of silently
    // leaving that job unenforced. This is what caught GIT_COMPATIBILITY and
    // SHELL_CONTRACTS being absent from an earlier hardcoded list.
    // Routing and directory guards fail before the per-lane success checks.
    const successMarker = '# Require success when the PR has code-relevant changes'
    const successLoop = verifyStep.run.slice(verifyStep.run.indexOf(successMarker))
    expect(successLoop.length).toBeGreaterThan(0)
    for (const job of prWorkflow.jobs.verify.needs) {
      const envVar = job.toUpperCase().replaceAll('-', '_')
      expect(verifyStep.env[envVar]).toBe(`\${{ needs.${job}.result }}`)
      if (job === 'code_paths') {
        expect(verifyStep.run).toContain(`if [ "$${envVar}" != "success" ]; then\n  exit 1\nfi`)
        continue
      }
      expect(successLoop).toContain(`"$${envVar}"`)
    }
  })
  it('keeps dedicated E2E workflows from self-triggering on pull requests', () => {
    // Why this still holds for terminal-ime-e2e.yml now that pr.yml runs it: pr.yml reaches it
    // through workflow_call, behind the path filter. A pull_request trigger here would run a
    // real ibus session on every PR, which is the cost the filter exists to avoid.
    const dedicatedWorkflows = [
      'golden-e2e-experiment.yml',
      'linux-wayland-gpu-sandbox.yml',
      'terminal-ime-e2e.yml',
      'win-crash-survival-e2e.yml',
      'windows-terminal-restart-e2e.yml'
    ]

    for (const file of dedicatedWorkflows) {
      const workflow = parseYaml(readFileSync(join(projectDir, '.github/workflows', file), 'utf8'))
      expect(workflow.on.pull_request, file).toBeUndefined()
    }
  })
  it('scopes detection to the PR range so base drift cannot false-trigger', () => {
    expect(filterStep.run).toMatch(/diff-base\.mjs "\$BASE"[\s\S]*"\$DIFF_BASE" HEAD/)
    expect(filterStep.run).toContain('set -euo pipefail')
  })
  it('puts the real-IME lane on the PR gate behind the IME source filter', () => {
    // Why a whole lane and not a spec in changed-e2e: the harness is an ibus-daemon, an xfwm4
    // session, and an X11 display; the generic lane has none of them and the spec would skip.
    expect(nativeImeWorkflow.on.workflow_call).toBeDefined()
    expect(prWorkflow.jobs.terminal_ime_native.uses).toBe(
      './.github/workflows/terminal-ime-e2e.yml'
    )
    expect(prWorkflow.jobs.terminal_ime_native.needs).toBe('code_paths')
    expect(prWorkflow.jobs.terminal_ime_native.if).toBe(
      "needs.code_paths.outputs.native_ime_source_changed == 'true'"
    )
    expect(prWorkflow.jobs.code_paths.outputs.native_ime_source_changed).toBe(
      '${{ steps.e2e_filter.outputs.native_ime_source_changed }}'
    )
    expect(filterStep.run).toContain('pr-e2e-source-routing.mjs --native-ime-source')
    expect(filterStep.run).toContain('native_ime_source_changed=$NATIVE_IME_SOURCE_CHANGED')

    // Why: continue-on-error would report the lane green and hide every failure it exists to
    // surface. Advisory here means "absent from verify.needs", not "always passes".
    expect(prWorkflow.jobs.terminal_ime_native['continue-on-error']).toBeUndefined()
    expect(prWorkflow.jobs.verify.needs).not.toContain('terminal_ime_native')
    expect(verifyStep.env.TERMINAL_IME_NATIVE).toBeUndefined()

    const routeIds = PR_E2E_SOURCE_ROUTES.map((route) => route.id)
    for (const id of NATIVE_IME_SOURCE_ROUTE_IDS) {
      expect(routeIds, id).toContain(id)
    }
  })
  it('gives every input-method-gated spec a lane that runs it, or an honest exemption', () => {
    // Why this shape: a spec gated on a native-IME env var that no runner sets is a skip that
    // reports as a pass. This repo already carries such specs; the point is that they are named
    // as gaps rather than counted as coverage.
    const nativeGateExpression = /ORCA_E2E_NATIVE_(?:IBUS_HANGUL|MACOS_KOREAN)\s*[!=]==\s*['"]1['"]/
    const nativeGatedSpecs = readdirSync(join(projectDir, 'tests/e2e'))
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => `tests/e2e/${file}`)
      .filter((spec) => nativeGateExpression.test(readFileSync(join(projectDir, spec), 'utf8')))
    expect(nativeGatedSpecs.length).toBeGreaterThan(0)

    // The macOS spec needs a native input source; PR and scheduled IME lanes use Linux.
    const unreachableSpecs = new Set(['tests/e2e/terminal-macos-2set-korean-native.spec.ts'])
    const unclaimed = nativeGatedSpecs.filter(
      (spec) => !unreachableSpecs.has(spec) && !nativeImeRunner.includes(spec)
    )
    expect(
      unclaimed,
      `Native-IME-gated specs claimed by no lane runner: ${unclaimed.join(', ')}`
    ).toEqual([])

    for (const spec of unreachableSpecs) {
      expect(nativeGatedSpecs, spec).toContain(spec)
      expect(nativeImeRunner.includes(spec), `${spec} is exempt but still invoked`).toBe(false)
    }
  })
  it('requires proof an input method engaged before the lane may report success', () => {
    // Why this is the assertion that matters: every other check in this file protects a job from
    // not running. This one protects a job that ran from having exercised nothing.
    expect(nativeImeRunner).toContain('verifyImeEngagementReceipts')
    expect(nativeImeRunner).toContain(`[IME_ENGAGEMENT_RECEIPT_ENV]: receiptPath`)
    expect(nativeImeSpec).toContain('appendImeEngagementReceipt(testInfo.title, trace)')

    // Why: the synthetic CDP step runs first in the same job. Under the default success()
    // condition its failure skipped the real-IME step, so the half that needs an input method
    // reported nothing on exactly the changes that broke IME code.
    const nativeStep = nativeImeWorkflow.jobs['linux-x11'].steps.find(
      (step) => step.name === 'Run native IBus Hangul exact-byte tests'
    )
    expect(nativeStep.if).toBe('!cancelled()')

    // Why a literal comparison: the spec cannot import the .mjs module, so the env var name is
    // written twice and would otherwise drift into a receipt nobody reads.
    const specSideReceipt = readFileSync(
      join(projectDir, 'tests/e2e/terminal-ime-engagement-receipt.ts'),
      'utf8'
    )
    expect(specSideReceipt).toContain(`'${IME_ENGAGEMENT_RECEIPT_ENV}'`)

    // Why pin the titles: the runner requires one receipt per name, so a rename that nobody
    // mirrored here would fail the lane loudly instead of quietly halving it.
    const nativeDigitSpec = readFileSync(
      join(projectDir, 'tests/e2e/terminal-hangul-terminating-digit-native.spec.ts'),
      'utf8'
    )
    expect(nativeDigitSpec).toContain('appendImeEngagementReceipt(testInfo.title, trace)')
    for (const title of EXPECTED_NATIVE_IME_TESTS) {
      expect(nativeImeSpec + nativeDigitSpec, title).toContain(title)
    }
  })
  it('keeps source-routed sentinels registered to their reliability gates', () => {
    const routedGateIds = [
      'terminal-startup.quick-command-pre-bind-recovery',
      'quick-open.paired-host-path-search',
      'terminal-session.host-cold-park-stream-continuity',
      'terminal-provider.ssh-remote-reattach-contract',
      'terminal-session.remote-pane-layout-retry'
    ]
    for (const gateId of routedGateIds) {
      const route = PR_E2E_SOURCE_ROUTES.find((candidate) => candidate.id === gateId)
      const gate = reliabilityManifest.gates.find((candidate) => candidate.id === gateId)
      expect(route, gateId).toBeDefined()
      expect(gate, gateId).toMatchObject({ maturity: 'experimental', protection: 'partial' })
      for (const spec of route.specs) {
        expect(gate.testFiles, gateId).toContain(spec)
        expect(
          gate.commands.some((command) => command.includes(spec)),
          gateId
        ).toBe(true)
      }
    }
  })
})

describe('changed E2E lane isolation', () => {
  it('retains sharding, headful admission, and dedicated owner filtering', () => {
    const workflow = parseYaml(readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8'))
    expect(workflow.jobs.e2e.if).toBe("inputs.test_files == ''")
    const changed = workflow.jobs['changed-e2e']
    expect(changed.strategy).toBeUndefined()
    expect(changed['timeout-minutes']).toBeGreaterThanOrEqual(45)
    const run = changed.steps.find((step) => step.name === 'Run changed E2E specs')
    expect(run.env.TEST_FILES_JSON).toBe('$' + '{{ inputs.test_files }}')
    expect(run.run).toContain('config/scripts/ci-e2e-job-selection.mjs')
    expect(run.run).toContain('E2E_PROJECT_ARGS+=(--project=electron-headful)')
    expect(run.run).toContain('--workers=1')
    expect(readFileSync(join(projectDir, 'tests/playwright.config.ts'), 'utf8')).toContain(
      'retries: 0'
    )
    for (const job of ['build', 'e2e', 'changed-e2e', 'orcad-ssh-docker']) {
      const install = workflow.jobs[job].steps.find(
        (step) => step.uses === './.github/actions/install-node-dependencies'
      )
      expect(install.with['native-runtime']).toBe(job === 'build' ? 'node' : 'electron')
    }
  })
})

it('retains the headful first-paint sentinel and paired startup shell prerequisites', () => {
  const workflow = parseYaml(readFileSync(join(projectDir, '.github/workflows/e2e.yml'), 'utf8'))
  const firstPaint = workflow.jobs.e2e.steps.filter((step) =>
    step.run?.includes('tests/e2e/worktree-switch-first-paint.spec.ts')
  )
  expect(firstPaint).toHaveLength(1)
  expect(firstPaint[0].if).toBe("matrix.shard == '1/14'")
  expect(firstPaint[0].run).toContain('xvfb-run --auto-servernum')
  expect(firstPaint[0].run).toContain('--project=electron-headful --workers=1')
  for (const job of ['e2e', 'changed-e2e']) {
    const install = workflow.jobs[job].steps.find((step) =>
      step.name?.startsWith('Install native build')
    )
    expect(linuxInstallPackageList(install, job), job).toMatch(/(^|\s)zsh(\s|$)/)
    expect(linuxInstallPackageList(install, job), job).toMatch(/(^|\s)openssh-client(\s|$)/)
  }
})
