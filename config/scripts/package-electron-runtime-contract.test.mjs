import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { relayArtifactFilenames } from '../../src/shared/relay-artifacts.ts'
import { APP_DISPLAY_NAME } from '../../src/shared/brand.ts'
import { selectTargets, targets } from './client-build-contract.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const { createPackagedRuntimeNodeModuleResources } = require('../packaged-runtime-node-modules.cjs')
const readProject = (file) => readFileSync(join(projectDir, file), 'utf8')
const packageJson = JSON.parse(readProject('package.json'))
const pnpmWorkspace = parse(readProject('pnpm-workspace.yaml'))
// Why not process.platform: the win32 plan resolves wherever its os-gated npm addon is
// installed; @orca/windows-registry is a workspace link and present everywhere.
const windowsAddonsInstalled = existsSync(
  join(projectDir, 'node_modules', '@vscode', 'windows-process-tree', 'package.json')
)

describe('Electron runtime package contract', () => {
  const packageTargets = {
    win32: windowsAddonsInstalled ? createPackagedRuntimeNodeModuleResources('win32') : [],
    darwin: createPackagedRuntimeNodeModuleResources('darwin'),
    linux: createPackagedRuntimeNodeModuleResources('linux')
  }

  it('keeps the native Windows registry addon optional and platform-gated', () => {
    expect(packageJson.optionalDependencies['@orca/windows-registry']).toBe('workspace:*')
    // Why: allowBuilds stops pnpm running node-gyp at install time -- the root
    // Windows-only rebuild owns this addon so it is built against the right runtime ABI.
    expect(pnpmWorkspace.allowBuilds['@orca/windows-registry']).toBe(false)
    if (windowsAddonsInstalled) {
      expect(packageTargets.win32).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'windows-registry') }),
          expect.objectContaining({ to: join('node_modules', 'node-addon-api') })
        ])
      )
    }
    for (const platform of ['darwin', 'linux']) {
      expect(packageTargets[platform]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'windows-registry') })
        ])
      )
    }
  })

  it('keeps the native Windows process-table addon optional and platform-gated', () => {
    expect(packageJson.optionalDependencies['@vscode/windows-process-tree']).toBe('0.8.0')
    // Why: same rule as the registry addon -- allowBuilds stops pnpm running node-gyp at
    // install time so the Windows-only rebuild owns it with the right runtime ABI.
    expect(pnpmWorkspace.allowBuilds['@vscode/windows-process-tree']).toBe(false)
    // Why pin the patch: the upstream binding.gyp requires Spectre-mitigated
    // libraries our build agents do not carry, and the enumeration stops after
    // 1024 processes -- on a busy host that silently hides the very descendants
    // teardown is looking for.
    expect(pnpmWorkspace.patchedDependencies['@vscode/windows-process-tree@0.8.0']).toBe(
      'config/patches/@vscode__windows-process-tree@0.8.0.patch'
    )
    if (windowsAddonsInstalled) {
      expect(packageTargets.win32).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@vscode', 'windows-process-tree') })
        ])
      )
    }
    for (const platform of ['darwin', 'linux']) {
      expect(packageTargets[platform]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@vscode', 'windows-process-tree') })
        ])
      )
    }
  })

  it('guards package scripts that launch Electron tooling', () => {
    const scripts = packageJson.scripts
    const guardedScripts = [
      'start',
      'dev',
      'dev-stable-name',
      'build:unpack',
      'build:mac:release',
      'test:e2e',
      'test:e2e:terminal-rendering-golden',
      'test:e2e:posix-profile-index-golden',
      'test:e2e:terminal-rendering-release-evidence',
      'test:e2e:headful'
    ]
    const delegatedTargets = {
      'build:win': 'windows-x64',
      'build:mac': 'macos',
      'build:linux': 'linux'
    }

    for (const scriptName of guardedScripts) {
      const command = scripts[scriptName]
      const guard = command.indexOf('pnpm run ensure:electron-runtime &&')
      const tooling = command.match(/electron-builder|electron-vite|playwright/)
      expect(guard, scriptName).toBeGreaterThanOrEqual(0)
      expect(tooling?.index, scriptName).toBeGreaterThan(guard)
    }
    for (const [scriptName, target] of Object.entries(delegatedTargets)) {
      expect(scripts[scriptName], scriptName).toBe(`pnpm run clients:build -- --target ${target}`)
    }
    expect(scripts['clients:build']).toBe(
      'node --use-env-proxy config/scripts/client-build.mjs build'
    )
    const driver = readProject('config/scripts/client-build.mjs')
    expect(driver).toContain("import { buildDesktop } from './client-build-desktop.mjs'")
    expect(driver).toContain("await buildDesktop(context, name, command === 'prepare')")
    const desktop = readProject('config/scripts/client-build-desktop.mjs')
    const preparation = desktop.match(
      /await nodeStep\(context, 'desktop-native', 'config\/scripts\/ensure-native-runtime\.mjs', \[\s*'--runtime=electron'\s*\]\)/
    )
    const compile = desktop.indexOf("await pnpmStep(context, 'desktop-compile'")
    const packaging = desktop.indexOf(
      "await nodeStep(context, 'desktop-package', 'node_modules/electron-builder/cli.js'"
    )
    expect(preparation).not.toBeNull()
    expect(compile).toBeGreaterThanOrEqual(0)
    expect(packaging).toBeGreaterThanOrEqual(0)
    expect(preparation.index).toBeLessThan(compile)
    expect(compile).toBeLessThan(packaging)
  })

  it('keeps Windows and Linux package builds off macOS native helper builds', () => {
    const scripts = packageJson.scripts

    expect(scripts['build:desktop']).not.toContain('build:computer-macos')
    expect(scripts['build:desktop']).not.toContain('build:keyboard-layout-macos')
    expect(scripts['build:win']).toBe('pnpm run clients:build -- --target windows-x64')
    expect(scripts['build:win']).not.toContain('pnpm run build ')
    expect(scripts['build:win']).not.toContain('build:computer-macos')
    expect(scripts['build:win']).not.toContain('build:keyboard-layout-macos')
    expect(scripts['build:linux']).toBe('pnpm run clients:build -- --target linux')
    expect(scripts['build:linux']).not.toContain('pnpm run build ')
    expect(scripts['build:linux']).not.toContain('build:computer-macos')
    expect(scripts['build:linux']).not.toContain('build:keyboard-layout-macos')
    expect(scripts['build:mac']).toBe('pnpm run clients:build -- --target macos')
    const desktop = readProject('config/scripts/client-build-desktop.mjs')
    const nativeDispatch = desktop.match(
      /if \(target\.host === 'darwin'\) \{\s*for \(const script of \[([\s\S]*?)\]\) \{\s*await pnpmStep\(context, script\.replaceAll\(':', '-'\), \['run', script\]\)\s*\}\s*\}/
    )
    const macHelpers = [
      'build:computer-macos',
      'build:keyboard-layout-macos',
      'build:notification-status-macos'
    ]
    expect(nativeDispatch).not.toBeNull()
    expect([...nativeDispatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(
      macHelpers
    )
    for (const helper of macHelpers) {
      expect(desktop.split(`'${helper}'`)).toHaveLength(2)
    }
    for (const [name, host, arch] of [
      ['windows-x64', 'win32', 'x64'],
      ['linux-x64', 'linux', 'x64'],
      ['linux-arm64', 'linux', 'arm64'],
      ['macos-x64', 'darwin', 'x64'],
      ['macos-arm64', 'darwin', 'arm64']
    ]) {
      expect(targets[name].host).toBe(host)
      expect(selectTargets(name, host, arch)).toEqual([name])
      expect(() => selectTargets(name, host === 'darwin' ? 'linux' : 'darwin', arch)).toThrow(
        'requires its native build host'
      )
    }
    expect(scripts['build:release']).toContain('pnpm run build:native')
    expect(scripts['build:release']).not.toContain('build:computer-macos')
  })

  it('runs the web build through the heap-sized Vite wrapper', () => {
    expect(packageJson.scripts['build:web']).toContain('node config/scripts/run-vite-web-build.mjs')
    expect(packageJson.scripts['build:web']).toContain('node config/scripts/verify-web-build.mjs')
  })

  it('guards release publishing before electron-builder runs', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const macWorkflow = parse(readProject('.github/workflows/release-mac-build.yml'))
    const releaseCommands = new Map(
      parsedWorkflow.jobs.build.strategy.matrix.include.map(({ platform, release_command }) => [
        platform,
        release_command
      ])
    )
    const macReleaseCommand = macWorkflow.jobs['build-mac'].steps.find(
      (step) => step.name === 'Build release artifacts (macOS)'
    ).with.command

    expect([...releaseCommands.keys()].sort()).toEqual(['linux-arm64', 'linux-x64', 'win'])
    for (const command of [...releaseCommands.values(), macReleaseCommand]) {
      expect(command).toContain('node config/scripts/ensure-native-runtime.mjs --runtime=electron')
      expect(command).toContain('electron-builder')
      expect(command.indexOf('ensure-native-runtime')).toBeLessThan(
        command.indexOf('electron-builder')
      )
    }
    expect(macReleaseCommand).toContain(' && ORCA_MAC_RELEASE=1 ')
    expect(releaseCommands.get('linux-x64')).toContain(' && pnpm exec electron-builder ')
    expect(releaseCommands.get('linux-x64')).toContain('--linux AppImage deb rpm --x64')
    expect(releaseCommands.get('linux-arm64')).toContain('ORCA_LINUX_ARM64_RELEASE=1')
    expect(releaseCommands.get('linux-arm64')).toContain('--linux AppImage deb rpm --arm64')
    expect(releaseCommands.get('win')).toContain(
      '; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm exec electron-builder '
    )
  })

  it('blocks Linux and macOS release packaging on watcher process fault recovery', () => {
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const macWorkflow = parse(readProject('.github/workflows/release-mac-build.yml'))
    const assertFaultGate = (steps, publishStepName, expectedCondition) => {
      const names = steps.map((step) => step.name)
      const gate = steps.find((step) => step.name === 'Gate runtime file-watcher process isolation')

      expect(gate.if).toBe(expectedCondition)
      expect(gate['continue-on-error']).toBeUndefined()
      expect(gate.run).toContain('node config/scripts/runtime-file-watcher-fault-harness.mjs')
      expect(gate.run).toContain('ELECTRON_RUN_AS_NODE=1 pnpm exec electron')
      expect(names.indexOf('Build app')).toBeLessThan(names.indexOf(gate.name))
      expect(names.indexOf(gate.name)).toBeLessThan(names.indexOf(publishStepName))
    }

    assertFaultGate(
      releaseWorkflow.jobs.build.steps,
      'Publish release artifacts (Linux)',
      "runner.os == 'Linux'"
    )
    assertFaultGate(
      macWorkflow.jobs['build-mac'].steps,
      'Build release artifacts (macOS)',
      undefined
    )
  })

  it('packages and release-gates the SSH relay watcher child', () => {
    const relayBuild = readProject('config/scripts/build-relay.mjs')
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const macWorkflow = parse(readProject('.github/workflows/release-mac-build.yml'))

    expect(relayBuild).toContain("'parcel-watcher-process-entry.ts'")
    expect(relayBuild).toContain("outfile: join(outDir, 'relay-watcher.js')")
    expect(relayBuild).toContain("outfile: join(outDir, 'relay-ai-vault-service.js')")
    expect(readProject('config/electron-builder.config.cjs')).toContain("from: 'out/relay'")

    // Hashing and remote install probing are manifest-driven, so the contract
    // is that both companions are declared once and that both sites read it.
    expect(relayArtifactFilenames(true)).toContain('relay-watcher.js')
    expect(relayArtifactFilenames(true)).toContain('relay-ai-vault-service.js')
    expect(relayBuild).toContain('relayArtifactFilenames(')
    expect(readProject('src/main/ssh/ssh-remote-commands.ts')).toContain('relayArtifactFilenames(')

    const assertRelayGate = (steps, publishStepName) => {
      const names = steps.map((step) => step.name)
      const gate = steps.find((step) => step.name === 'Gate SSH relay watcher process isolation')
      expect(gate['continue-on-error']).toBeUndefined()
      expect(gate.run).toContain('node config/scripts/relay-watcher-fault-harness.mjs')
      expect(names.indexOf('Build app')).toBeLessThan(names.indexOf(gate.name))
      expect(names.indexOf(gate.name)).toBeLessThan(names.indexOf(publishStepName))
    }

    assertRelayGate(releaseWorkflow.jobs.build.steps, 'Publish release artifacts (Linux)')
    assertRelayGate(macWorkflow.jobs['build-mac'].steps, 'Build release artifacts (macOS)')
    const releaseNames = releaseWorkflow.jobs.build.steps.map((step) => step.name)
    expect(releaseNames.indexOf('Gate SSH relay watcher process isolation')).toBeLessThan(
      releaseNames.indexOf('Build Windows release artifacts')
    )
  })

  it('packages and verifies the Windows SSH node-pty console-list fallback', () => {
    const relayBuild = readProject('config/scripts/build-relay.mjs')
    const relayDeploy = readProject('src/main/ssh/ssh-relay-deploy.ts')
    const patchAsset = readProject(
      'config/relay-assets/node-pty-1.1.0-console-list-agent-patch.cjs'
    )

    expect(relayBuild).toContain('copyFileSync(')
    expect(relayBuild).toContain('hash.update(readFileSync')
    expect(relayBuild).toContain('node-pty-1.1.0-console-list-agent-patch.cjs')
    expect(relayDeploy).toContain('assertPatchedNodePtyConsoleListAgent')
    expect(relayDeploy.match(/\$\{windowsNodePtyPatchCommand\(nodePath\)\}/g)).toHaveLength(2)
    expect(patchAsset).toContain('consoleProcessList = [shellPid];')
    expect(patchAsset).toContain('packageJson.version !== EXPECTED_NODE_PTY_VERSION')
  })

  it('pins the Windows release builder to the VS 2022 runner image', () => {
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const windowsReleaseEntry = releaseWorkflow.jobs.build.strategy.matrix.include.find(
      ({ platform }) => platform === 'win'
    )

    expect(windowsReleaseEntry.os).toBe('windows-2022')
  })

  it('keeps release-cut signing provenance on GitHub-hosted runners', () => {
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const buildMatrixRunners = releaseWorkflow.jobs.build.strategy.matrix.include.map(
      ({ os }) => os
    )
    const releaseWorkflowText = readProject('.github/workflows/release-cut.yml')
    const macDispatchStep = releaseWorkflow.jobs['build-mac'].steps.find(
      (step) => step.name === 'Run isolated macOS release build'
    )

    expect(releaseWorkflowText).not.toContain('blacksmith-')
    expect(releaseWorkflow.jobs['build-mac']['runs-on']).toBe('ubuntu-latest')
    expect(releaseWorkflow.jobs['build-mac'].permissions.actions).toBe('write')
    expect(macDispatchStep.run).toBe('node config/scripts/run-release-mac-build-workflow.mjs')
    expect(macDispatchStep.env.RELEASE_MAC_BUILD_WORKFLOW).toBe('release-mac-build.yml')
    expect(macDispatchStep.env.RELEASE_MAC_BUILD_TAG).toBe('${{ needs.cut.outputs.tag }}')
    expect(buildMatrixRunners).not.toContain('blacksmith-6vcpu-macos-15')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('build')
    expect(releaseWorkflow.jobs['publish-release'].needs).toContain('build-mac')
  })

  it('runs the macOS release build in an isolated Blacksmith workflow', () => {
    const releaseMacWorkflowText = readProject('.github/workflows/release-mac-build.yml')
    const releaseMacWorkflow = parse(releaseMacWorkflowText)
    const buildMacJob = releaseMacWorkflow.jobs['build-mac']
    const checkoutStep = buildMacJob.steps.find((step) => step.name === 'Checkout')
    const publishStep = buildMacJob.steps.find(
      (step) => step.name === 'Build release artifacts (macOS)'
    )

    expect(releaseMacWorkflow['run-name']).toBe(
      'Mac release build ${{ inputs.tag }} (${{ inputs.release_run_id }})'
    )
    expect(releaseMacWorkflow.on.workflow_dispatch.inputs.tag.required).toBe(true)
    expect(releaseMacWorkflow.on.workflow_dispatch.inputs.release_run_id.required).toBe(true)
    expect(buildMacJob['runs-on']).toBe('blacksmith-6vcpu-macos-15')
    expect(checkoutStep.with.ref).toBe('refs/tags/${{ inputs.tag }}')
    expect(publishStep.with.command).toContain('ORCA_MAC_RELEASE=1')
    expect(publishStep.with.command).toContain('electron-builder')
    expect(publishStep.with.command).toContain('--mac --publish never')
    expect(releaseMacWorkflowText).not.toContain('signpath/')
    expect(releaseMacWorkflowText).not.toContain('SIGNPATH_')
  })

  it('publishes both Linux release matrix entries', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const publishLinuxStep = parsedWorkflow.jobs.build.steps.find(
      (step) => step.name === 'Publish release artifacts (Linux)'
    )

    expect(publishLinuxStep.if).toContain("matrix.platform == 'linux-x64'")
    expect(publishLinuxStep.if).toContain("matrix.platform == 'linux-arm64'")
    expect(publishLinuxStep.with.command).toBe('${{ matrix.release_command }}')
  })

  it('keeps Linux postinstall repairing Chromium sandbox permissions', () => {
    const afterInstallScript = readProject('resources/linux/packaging/after-install.sh')

    expect(afterInstallScript).toContain('chrome-sandbox')
    expect(afterInstallScript).toContain('chmod 4755 "$sandbox"')
    expect(afterInstallScript).not.toContain('chmod 0755 "$sandbox"')
    const managedTargets = afterInstallScript.match(
      /is_managed_target\(\) \{\s*case "\$1" in\s*([\s\S]*?)\)\s*return 0\s*;;\s*esac\s*return 1\s*\}/
    )
    expect(managedTargets).not.toBeNull()
    expect(
      managedTargets[1]
        .replaceAll(/\\\r?\n/g, '')
        .split('|')
        .map((target) => target.trim())
    ).toEqual(
      [
        `/opt/${APP_DISPLAY_NAME}`,
        `/opt/${packageJson.name}`,
        '/opt/Orca',
        '/opt/orca-ide',
        '/opt/orca'
      ].flatMap((directory) =>
        ['hive', packageJson.name, 'orca-ide'].map(
          (command) => `${directory}/resources/bin/${command}`
        )
      )
    )
    expect(afterInstallScript).toMatch(
      /install_link\(\) \{\s*name="\$1"\s*shim="\$2"\s*link="\/usr\/bin\/\$name"\s*if \[ ! -e "\$link" \] && \[ ! -L "\$link" \]; then\s*ln -s "\$shim" "\$link"\s*return\s*fi\s*if \[ -L "\$link" \]; then\s*target="\$\(readlink -- "\$link" 2>\/dev\/null \|\| true\)"\s*if is_managed_target "\$target"; then\s*ln -sfn -- "\$shim" "\$link"\s*fi\s*fi\s*\n\}/
    )
    expect(afterInstallScript).toContain('[ ! -e "$link" ] && [ ! -L "$link" ]')
    expect(afterInstallScript).not.toContain('[ ! -e "$link" ] || [ -L "$link" ]')
  })

  it('advances only the skill release ledger in a taggable release-cut commit', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const checkoutStep = parsedWorkflow.jobs.cut.steps.find((step) => step.name === 'Checkout ref')
    const bumpStep = parsedWorkflow.jobs.cut.steps.find(
      (step) => step.name === 'Bump package.json and tag'
    )

    const bumpIndex = bumpStep.run.indexOf(
      'npm version "$VERSION" --no-git-tag-version --allow-same-version'
    )
    const generateIndex = bumpStep.run.indexOf(
      'node config/scripts/generate-skill-bundle-manifest.mjs --release "$VERSION"'
    )
    const commands = bumpStep.run.replace(/^\s*#.*$/gm, '')
    // Unanchored: a `git add` chained after `&&` stages just as effectively.
    const stagedPaths = [...commands.matchAll(/\bgit add (.+)$/gm)].flatMap((match) =>
      match[1].trim().split(/\s+/)
    )
    // Quotes trimmed and deduped: the index guard names the row a second time.
    const mentioned = new Set(commands.match(/resources[/\\]skills[^\s'"]*/g))
    expect(checkoutStep.with['fetch-depth']).toBe(0)
    expect(bumpIndex).toBeGreaterThanOrEqual(0)
    // Why: the cut is the only point that advances the release ledger, so this
    // tag's revision is never rebuilt later — it appends that row, nothing else.
    expect(generateIndex).toBeGreaterThan(bumpIndex)
    expect(bumpStep.run.indexOf('git add package.json')).toBeGreaterThan(generateIndex)
    expect(stagedPaths).toEqual(['package.json', 'resources/skills/release-mapping.json'])
    // Every distinct mention must be staged, so a copy, a redirect, or a path
    // held in a variable cannot reach the content-addressed artifacts. Matched
    // without a trailing slash so `dir="resources/skills"` still counts.
    expect([...mentioned]).toEqual(stagedPaths.slice(1))
    // Regeneration is banned job-wide by the generator suite. Here: `-a`, `-am`,
    // and `--all` sweep unstaged artifacts in; `--allow-empty` below must not.
    expect(commands).not.toMatch(/\bcommit\b[^\n]*(?:\s-[a-z]*a[a-z]*\b|\s--all\b)/)
    expect(bumpStep.run).toContain('git diff --cached --quiet')
    expect(bumpStep.run).toContain('git commit --allow-empty -m "$commit_message"')
  })

  it('keeps release-cut RC retries monotonic across stale attempts', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const versionStep = parsedWorkflow.jobs.cut.steps.find(
      (step) => step.name === 'Compute next version'
    )

    expect(versionStep.run).toContain('node config/scripts/release-rc-history.mjs "$1"')
    expect(versionStep.run).toContain('tag_matches_current_ref')
    expect(versionStep.run).toContain('cutting the next version instead of reusing stale artifacts')
    expect(versionStep.run).toContain('git rev-parse "$existing_rc_tag"')
  })

  it('bumps separate Homebrew casks for stable and RC desktop tags', () => {
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const homebrewWorkflow = parse(readProject('.github/workflows/homebrew-bump.yml'))

    expect(releaseWorkflow.jobs['homebrew-bump'].if).toContain(
      "startsWith(needs.cut.outputs.tag, 'v')"
    )
    expect(releaseWorkflow.jobs['homebrew-bump'].if).not.toContain('-rc.')
    expect(releaseWorkflow.jobs['homebrew-bump-published-rc-draft'].with.tag).toBe(
      '${{ needs.cut.outputs.latest_published_rc_tag }}'
    )

    const resolveCaskStep = homebrewWorkflow.jobs['bump-cask'].steps.find(
      (step) => step.name === 'Resolve cask target'
    )
    const renderStep = homebrewWorkflow.jobs['bump-cask'].steps.find(
      (step) => step.name === 'Render updated cask file'
    )
    const copyStep = homebrewWorkflow.jobs['bump-cask'].steps.find(
      (step) => step.name === 'Copy cask into tap and open PR'
    )

    expect(resolveCaskStep.run).toContain('token="orca@rc"')
    expect(resolveCaskStep.run).toContain('token="orca"')
    expect(renderStep.env.CASK_PATH).toBe('${{ steps.cask.outputs.path }}')
    expect(copyStep.run).toContain('cp "$CASK_PATH" "tap/$CASK_PATH"')
    expect(copyStep.run).toContain('git add "$CASK_PATH"')
  })

  it('installs the Electron package binary in the shared unit-test workflow', () => {
    const unitTestWorkflow = parse(readProject('.github/workflows/unit-tests.yml'))
    const installStep = unitTestWorkflow.jobs.test.steps.find(
      (step) => step.name === 'Install Electron package binary for tests'
    )

    expect(installStep.run).toBe('node config/scripts/install-electron-package-binary.mjs')
  })

  it('smokes the packaged CLI from outside the checkout in PR checks', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/pr.yml'))
    const smokeStep = parsedWorkflow.jobs.package.steps.find(
      (step) => step.name === 'Smoke packaged CLI'
    )

    expect(smokeStep.run).toBe(
      'node config/scripts/smoke-packaged-cli.mjs --app-dir=dist/linux-unpacked'
    )
  })

  it('keeps terminal scale perf wired to the report budget gate', () => {
    const packageScripts = packageJson.scripts
    const terminalPerfWorkflow = parse(readProject('.github/workflows/terminal-perf.yml'))
    const steps = terminalPerfWorkflow.jobs['terminal-perf'].steps
    const runStep = steps.find((step) => step.name === 'Run terminal scale perf report gate')
    const uploadStep = steps.find((step) => step.name === 'Upload terminal perf report')

    expect(packageScripts['test:e2e:terminal-perf:scale:report']).toContain(
      'run-terminal-scale-perf-report-gate.mjs'
    )
    expect(runStep.run).toContain('pnpm run test:e2e:terminal-perf:scale:report')
    expect(runStep.run).toContain('xvfb-run --auto-servernum')
    const manualProfileKnobs = [
      ['ORCA_TERMINAL_PERF_FRAME_COUNT', 'frame_count', 'ORCA_E2E_OPENCODE_FRAME_COUNT'],
      [
        'ORCA_TERMINAL_PERF_FRAME_INTERVAL_MS',
        'frame_interval_ms',
        'ORCA_E2E_OPENCODE_FRAME_INTERVAL_MS'
      ],
      [
        'ORCA_TERMINAL_PERF_PRESSURE_OUTPUT_CHARS',
        'pressure_output_chars',
        'ORCA_E2E_OPENCODE_PRESSURE_OUTPUT_CHARS'
      ],
      ['ORCA_TERMINAL_PERF_SCALE_PANES', 'scale_panes', 'ORCA_E2E_OPENCODE_SCALE_PANES'],
      [
        'ORCA_TERMINAL_PERF_SCALE_CROSS_WORKSPACE_PANES',
        'scale_cross_workspace_panes',
        'ORCA_E2E_OPENCODE_SCALE_CROSS_WORKSPACE_PANES'
      ],
      [
        'ORCA_TERMINAL_PERF_SCALE_PRESSURE_PANES',
        'scale_pressure_panes',
        'ORCA_E2E_OPENCODE_SCALE_PRESSURE_PANES'
      ],
      [
        'ORCA_TERMINAL_PERF_SCALE_HIDDEN_PRESSURE_PANES',
        'scale_hidden_pressure_panes',
        'ORCA_E2E_OPENCODE_SCALE_HIDDEN_PRESSURE_PANES'
      ]
    ]
    for (const [workflowEnv, inputName, runnerEnv] of manualProfileKnobs) {
      expect(runStep.env[workflowEnv]).toBe(`\${{ inputs.${inputName} }}`)
      expect(runStep.run).toContain(runnerEnv)
    }
    expect(uploadStep.uses).toBe('actions/upload-artifact@v7')
    expect(uploadStep.with.path).toBe('${{ env.ORCA_E2E_TERMINAL_PERF_REPORT_PATH }}')
  })

  it('keeps platform golden regressions in the manual and release workflows', () => {
    const packageScripts = packageJson.scripts
    const goldenWorkflow = parse(readProject('.github/workflows/golden-e2e-experiment.yml'))
    const releaseWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const steps = goldenWorkflow.jobs['golden-e2e'].steps
    const goldenPlatformLabels = new Map([
      ['linux', 'Linux'],
      ['mac', 'macOS'],
      ['windows', 'Windows']
    ])
    const goldenMatrix = goldenWorkflow.jobs['golden-e2e'].strategy.matrix.include
    const goldenPlatforms = goldenMatrix.map(({ platform }) => platform).sort()
    const goldenRunSteps = new Map(
      goldenPlatforms.map((platform) => {
        const label = goldenPlatformLabels.get(platform)

        expect(label, platform).toBeDefined()

        return [platform, steps.find((step) => step.name === `Run golden E2E tests on ${label}`)]
      })
    )
    const releaseGoldenJob = releaseWorkflow.jobs['terminal-rendering-golden']
    const releaseGoldenMatrix = releaseGoldenJob.strategy.matrix.include
    const releaseEvidenceJob = releaseWorkflow.jobs['terminal-rendering-release-evidence']
    const releaseBuildNeeds = releaseWorkflow.jobs.build.needs
    const publishReleaseNeeds = releaseWorkflow.jobs['publish-release'].needs
    // Why: Windows release evidence is temporarily paused for CI runner PTY readiness.
    const releaseEvidencePlatforms = ['linux', 'mac']

    expect(packageScripts['test:e2e:terminal-rendering-golden']).toContain(
      '@terminal-rendering-golden'
    )
    expect(packageScripts['test:e2e:terminal-rendering-golden']).toContain(
      'terminal-raw-emoji-table-scroll-restore.spec.ts'
    )
    expect(packageScripts['test:e2e:terminal-rendering-golden']).toContain(
      'terminal-webgl-atlas-budget.spec.ts'
    )
    expect(packageScripts['test:e2e:terminal-rendering-golden']).not.toContain(
      'terminal-long-table-scroll-restore.spec.ts'
    )
    const goldenCommand = packageScripts['test:e2e:terminal-rendering-golden']
    expect(goldenCommand).toContain('--project electron-headless')
    expect(goldenCommand).toContain('--project electron-headful')
    expect(packageScripts['test:e2e:windows-fresh-startup-golden']).toContain(
      'golden-windows-fresh-startup.spec.ts'
    )
    expect(packageScripts['test:e2e:windows-fresh-startup-golden']).toContain(
      '@windows-fresh-startup-golden'
    )
    expect(packageScripts['test:e2e:posix-profile-index-golden']).toContain(
      'golden-posix-profile-index-fsync.spec.ts'
    )
    expect(packageScripts['test:e2e:posix-profile-index-golden']).toContain(
      'golden-posix-fresh-startup.spec.ts'
    )
    expect(packageScripts['test:e2e:posix-profile-index-golden']).toContain(
      '@posix-profile-index-golden'
    )
    expect(packageScripts['test:e2e:terminal-rendering-release-evidence']).toContain(
      'terminal-opencode-emoji-table-rendering.spec.ts'
    )
    expect(packageScripts['test:e2e:terminal-rendering-release-evidence']).toContain(
      'terminal-long-table-scroll-restore.spec.ts'
    )
    expect(goldenMatrix).toEqual([
      { os: 'ubuntu-22.04', platform: 'linux' },
      { os: 'macos-15', platform: 'mac' },
      { os: 'windows-2022', platform: 'windows' }
    ])
    expect(goldenRunSteps.get('windows')).toMatchObject({
      if: "runner.os == 'Windows'",
      shell: 'pwsh'
    })
    expect(goldenRunSteps.get('windows').run).toContain(
      'pnpm run --if-present test:e2e:windows-fresh-startup-golden'
    )
    expect(goldenWorkflow.on.pull_request).toBeUndefined()
    expect(goldenWorkflow.on.workflow_dispatch).toBeDefined()
    expect(releaseBuildNeeds).not.toContain('terminal-rendering-golden')
    expect(releaseBuildNeeds).not.toContain('terminal-rendering-release-evidence')
    expect(publishReleaseNeeds).toContain('terminal-rendering-golden')
    expect(publishReleaseNeeds).toContain('build')
    expect(publishReleaseNeeds).not.toContain('terminal-rendering-release-evidence')
    expect(releaseGoldenJob['continue-on-error']).toBeUndefined()
    expect(releaseGoldenMatrix).toEqual(goldenMatrix)
    for (const platform of ['linux', 'mac']) {
      const releaseRunStep = releaseGoldenJob.steps.find(
        (step) =>
          step.name === `Run terminal rendering golden on ${goldenPlatformLabels.get(platform)}`
      )
      for (const runStep of [goldenRunSteps.get(platform), releaseRunStep]) {
        expect(runStep.run).toContain('pnpm run test:e2e:terminal-rendering-golden')
        expect(runStep.run).toContain('pnpm run --if-present test:e2e:posix-profile-index-golden')
      }
    }
    const releaseWindowsRunStep = releaseGoldenJob.steps.find(
      (step) => step.name === 'Run fresh-startup golden on Windows'
    )
    expect(releaseWindowsRunStep).toMatchObject({
      if: "runner.os == 'Windows'",
      shell: 'pwsh'
    })
    expect(releaseWindowsRunStep.run).toContain(
      'pnpm run --if-present test:e2e:windows-fresh-startup-golden'
    )
    expect(releaseWindowsRunStep.run).not.toContain('test:e2e:workspace-session-golden')
    expect(releaseWindowsRunStep.run).not.toContain('test:e2e:source-control-golden')
    expect(releaseEvidenceJob['continue-on-error']).toBe(true)
    expect(
      releaseEvidenceJob.strategy.matrix.include.map(({ platform }) => platform).sort()
    ).toEqual(releaseEvidencePlatforms)
    expect(releaseEvidenceJob.steps.map((step) => step.run ?? '')).toContain(
      'xvfb-run --auto-servernum env SKIP_BUILD=1 ORCA_E2E_FORWARD_APP_LOGS=1 pnpm run test:e2e:terminal-rendering-release-evidence'
    )
  })
})
