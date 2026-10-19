import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  OPENCODE_SQLITE_READER_FILENAME,
  WSL_CLAUDE_PROFILE_HELPER_FILENAME
} from '../../src/shared/remote-bundle-artifacts.ts'
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

  function expectWindowsAddon(name, version, resources = [name]) {
    expect(packageJson.optionalDependencies[name]).toBe(version)
    // The root Windows rebuild owns these addons and their runtime ABI.
    expect(pnpmWorkspace.allowBuilds[name]).toBe(false)
    const resource = (moduleName) =>
      expect.objectContaining({ to: join('node_modules', moduleName) })
    if (windowsAddonsInstalled) {
      expect(packageTargets.win32).toEqual(expect.arrayContaining(resources.map(resource)))
    }
    for (const platform of ['darwin', 'linux']) {
      expect(packageTargets[platform]).not.toEqual(expect.arrayContaining([resource(name)]))
    }
  }

  it('keeps the native Windows registry addon optional and platform-gated', () => {
    expectWindowsAddon('@orca/windows-registry', 'workspace:*', [
      '@orca/windows-registry',
      'node-addon-api'
    ])
  })

  // Without it the secure-file writes report unrestricted and orcad's privacy check fails closed.
  it('ships the native Windows ACL addon on Windows only, built by the Windows rebuild', () => {
    expect(packageJson.optionalDependencies['@orca/windows-security']).toBe('workspace:*')
    expect(pnpmWorkspace.allowBuilds['@orca/windows-security']).toBe(false)
    if (windowsAddonsInstalled) {
      expect(packageTargets.win32).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'windows-security') })
        ])
      )
    }
    for (const platform of ['darwin', 'linux']) {
      expect(packageTargets[platform]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'windows-security') })
        ])
      )
    }
  })

  it('keeps the native Windows process-table addon optional and platform-gated', () => {
    expectWindowsAddon('@vscode/windows-process-tree', '0.8.0')
    // The patch removes unavailable Spectre libraries and the 1024-process enumeration cap.
    expect(pnpmWorkspace.patchedDependencies['@vscode/windows-process-tree@0.8.0']).toBe(
      'config/patches/@vscode__windows-process-tree@0.8.0.patch'
    )
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
    const desktopImport = driver.match(
      /const buildDesktop = \['android', 'ios'\]\.includes\(name\)\s*\? undefined\s*: \(await import\('\.\/client-build-desktop\.mjs'\)\)\.buildDesktop/
    )
    expect(desktopImport).not.toBeNull()
    const dependencies = driver.indexOf('await prepareTargetDependencies(context, name)')
    expect(dependencies).toBeGreaterThanOrEqual(0)
    expect(desktopImport.index).toBeGreaterThan(dependencies)
    expect(
      driver.indexOf("await buildDesktop(context, name, command === 'prepare')")
    ).toBeGreaterThan(desktopImport.index)
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
    expect(desktop).toContain(
      "await pnpmStep(context, 'desktop-native-tools', ['run', 'build:native'])"
    )
    expect(scripts['build:native']).toBe('node config/scripts/build-native-for-platform.mjs')
    const nativeBuild = readProject('config/scripts/build-native-for-platform.mjs')
    const nativeDispatch = nativeBuild.match(
      /const exitCodes = await Promise\.all\(\s*\[([\s\S]*?)\]\.map\(\s*\(scriptName\) => runPnpmScript\(scriptName\)\s*\)\s*\)/
    )
    const macHostGuard = nativeBuild.match(
      /if \(process\.platform !== 'darwin'\) \{[^}]*\}[^}]*process\.exit\(0\)\s*\}/
    )
    expect(macHostGuard).not.toBeNull()
    expect(nativeBuild.indexOf(macHostGuard[0])).toBeLessThan(
      nativeBuild.indexOf('const exitCodes =')
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
      expect(nativeBuild.split(`'${helper}'`)).toHaveLength(2)
      expect(desktop).not.toContain(`'${helper}'`)
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

  it('packages the current WSL guest producers under the relay resource directory', () => {
    const guestBuild = readProject('config/scripts/build-wsl-guest.mjs')
    const builder = readProject('config/electron-builder.config.cjs')

    expect(packageJson.scripts['build:wsl-guest']).toContain('config/scripts/build-wsl-guest.mjs')
    for (const script of [
      'build:desktop',
      'build:release',
      'build:release:host',
      'build:release:parallel'
    ]) {
      expect(packageJson.scripts[script]).toContain('pnpm run build:wsl-guest')
    }
    expect(guestBuild).toContain("join(ROOT, 'out', 'relay')")
    expect(guestBuild).toContain("const outDir = join(OUT_ROOT, 'wsl')")
    expect(guestBuild).toContain('rmSync(OUT_ROOT, { recursive: true, force: true })')
    expect(guestBuild).toContain("from '../../src/shared/remote-bundle-artifacts.ts'")
    expect(guestBuild).toContain(
      "bundle('src/wsl-guest/wsl-agent-hook-relay.ts', 'wsl-agent-hook-relay.js'"
    )
    expect(guestBuild).toContain(
      "bundle('src/wsl-guest/wsl-browser-network-relay.ts', 'wsl-browser-network-relay.js')"
    )
    expect(guestBuild).toMatch(
      /bundle\(\s*'src\/main\/claude-accounts\/claude-profile-wsl-entry.ts',\s*WSL_CLAUDE_PROFILE_HELPER_FILENAME/
    )
    expect(guestBuild).toMatch(
      /bundle\(\s*'src\/main\/ai-vault\/session-scanner-opencode-sqlite-process-entry.ts',\s*OPENCODE_SQLITE_READER_FILENAME/
    )
    expect(WSL_CLAUDE_PROFILE_HELPER_FILENAME).toBe('claude-profile-wsl.cjs')
    expect(OPENCODE_SQLITE_READER_FILENAME).toBe('opencode-sqlite-reader.cjs')
    expect(guestBuild).toContain("stampVersion('wsl-agent-hook-relay.js', '.version')")
    expect(guestBuild).toContain(
      "stampVersion('wsl-browser-network-relay.js', '.browser-network-version')"
    )
    expect(guestBuild).toContain("createHash('sha256')")
    expect(guestBuild).toContain('.update(readFileSync(join(outDir, bundleFile)))')
    expect(builder).toMatch(/from: 'out\/relay',\s*to: 'relay'/)
    for (const retired of [
      'config/scripts/build-relay.mjs',
      'config/scripts/relay-watcher-fault-harness.mjs',
      'src/main/ssh/ssh-relay-deploy.ts'
    ]) {
      expect(existsSync(join(projectDir, retired)), retired).toBe(false)
    }
  })

  it('binds the Windows node-pty console-list fallback to the current pnpm patch', () => {
    const patchPath = pnpmWorkspace.patchedDependencies['node-pty@1.1.0']
    expect(patchPath).toBe('config/patches/node-pty@1.1.0.patch')
    expect(packageJson.dependencies['node-pty']).toBe('^1.1.0')
    const patch = readProject(patchPath)
    for (const file of ['lib/conpty_console_list_agent.js', 'src/conpty_console_list_agent.ts']) {
      const section = patch.split(`diff --git a/${file} b/${file}`)[1]?.split('diff --git ')[0]
      expect(section, file).toBeDefined()
      expect(section, file).toContain('consoleProcessList = [shellPid];')
    }
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

  it('verifies skill artifacts without changing their ledger in a version-only release-cut commit', () => {
    const parsedWorkflow = parse(readProject('.github/workflows/release-cut.yml'))
    const checkoutStep = parsedWorkflow.jobs.cut.steps.find((step) => step.name === 'Checkout ref')
    const bumpStep = parsedWorkflow.jobs.cut.steps.find(
      (step) => step.name === 'Bump package.json and tag'
    )

    const bumpIndex = bumpStep.run.indexOf(
      'npm version "$VERSION" --no-git-tag-version --allow-same-version'
    )
    const verifyIndex = bumpStep.run.indexOf(
      'if ! node config/scripts/generate-skill-bundle-manifest.mjs; then'
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
    expect(verifyIndex).toBeGreaterThan(bumpIndex)
    expect(bumpStep.run.indexOf('git add package.json')).toBeGreaterThan(verifyIndex)
    expect(commands).toMatch(
      /if ! node config\/scripts\/generate-skill-bundle-manifest\.mjs; then(?:(?!\bfi\b)[\s\S])*exit 1\s*fi/
    )
    expect(commands).not.toMatch(/--release|--write|generate:skill-bundle-manifest/)
    expect(stagedPaths).toEqual(['package.json'])
    // Every distinct mention must be staged, so a copy, a redirect, or a path
    // held in a variable cannot reach the content-addressed artifacts. Matched
    // without a trailing slash so `dir="resources/skills"` still counts.
    expect([...mentioned]).toEqual(stagedPaths.slice(1))
    // Regeneration is banned job-wide by the generator suite. Here: `-a`, `-am`,
    // and `--all` sweep unstaged artifacts in; `--allow-empty` below must not.
    expect(commands).not.toMatch(/\bcommit\b[^\n]*(?:\s-[a-z]*a[a-z]*\b|\s--all\b)/)
    expect(bumpStep.run).toContain('git diff --cached --quiet')
    expect(bumpStep.run).toContain('git commit --allow-empty -m "$commit_message"')
    // The actual commit guard also catches paths staged elsewhere or committed outside the index.
    expect(commands).toMatch(
      /git diff-tree --no-commit-id --name-only -r -m --first-parent HEAD\s*\|\s*grep -vxF -e 'package\.json'\s*\|\| true\)/
    )
    expect(commands).toMatch(/if \[\[ -n "\$committed" \]\]; then(?:(?!\bfi\b)[\s\S])*exit 1\s*fi/)
    const commitGuard = commands.indexOf('git diff-tree --no-commit-id')
    expect(commitGuard).toBeGreaterThan(commands.indexOf('git commit -m "$commit_message"'))
    expect(commands.indexOf('git tag -a "v$VERSION"')).toBeGreaterThan(commitGuard)
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

  it('verifies and uploads the AppImage produced by the PR package config', () => {
    const config = require('../electron-builder-pr-linux.config.cjs')
    const artifact = `dist/${config.appImage.artifactName.replace('${ext}', 'AppImage')}`
    const steps = parse(readProject('.github/workflows/pr.yml')).jobs.package.steps
    const markerStep = steps.find((step) => step.name === 'Verify root-package marker payloads')
    expect(markerStep.run).toContain(`"$GITHUB_WORKSPACE/${artifact}" --appimage-extract`)
    expect(markerStep.run).toContain(`ls -l ${artifact} "$deb" "$rpm"`)
    expect(
      steps.some(
        (step) => step.uses === 'actions/upload-artifact@v7' && step.with.path === artifact
      )
    ).toBe(true)
    for (const name of [
      'Verify headless serve signal shutdown',
      'Verify Linux CLI launch contract'
    ]) {
      expect(steps.find((step) => step.name === name).run).toContain(`--appimage ${artifact}`)
    }
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
      ['FRAME_COUNT', 'frame_count'],
      ['FRAME_INTERVAL_MS', 'frame_interval_ms'],
      ['PRESSURE_OUTPUT_CHARS', 'pressure_output_chars'],
      ['SCALE_PANES', 'scale_panes'],
      ['SCALE_CROSS_WORKSPACE_PANES', 'scale_cross_workspace_panes'],
      ['SCALE_PRESSURE_PANES', 'scale_pressure_panes'],
      ['SCALE_HIDDEN_PRESSURE_PANES', 'scale_hidden_pressure_panes']
    ]
    for (const [suffix, inputName] of manualProfileKnobs) {
      expect(runStep.env[`ORCA_TERMINAL_PERF_${suffix}`]).toBe(`\${{ inputs.${inputName} }}`)
      expect(runStep.run).toContain(`ORCA_E2E_OPENCODE_${suffix}`)
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
