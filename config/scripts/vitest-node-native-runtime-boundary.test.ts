import { readFileSync } from 'node:fs'
import ts from 'typescript-api'
import { expect, it } from 'vitest'
import { NODE_RUNTIME_INCLUDE } from './vitest-node-runtime-files.mjs'
import { callsImportedRuntime } from './vitest-runtime-owner-source'

it('runs artifact profile persistence and share races with real secure-file protection on Node', () => {
  for (const name of ['artifact-cloud-service', 'artifact-cloud-service-races']) {
    const owner = `src/main/artifacts/${name}.test.ts`
    expect(readFileSync(owner, 'utf8')).not.toMatch(
      /vi\.mock\(['"][^'"]*(?:secure-file|artifact-share-record-store)/
    )
    expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  }
  const owner = 'src/main/artifacts/artifact-cloud-service.test.ts'
  const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
  for (const [module, name] of [
    ['/profile-index-store', 'ensureActiveOrcaProfile'],
    ['/profile-cloud-index', 'linkOrcaProfileToCloud'],
    ['/profile-cloud-session-mutation', 'recordSuccessfulCloudSessionLogin']
  ]) {
    expect(callsImportedRuntime(source, module, name), name).toBe(true)
  }
  const races = readFileSync('src/main/artifacts/artifact-cloud-service-races.test.ts', 'utf8')
  expect(races).toContain('new ArtifactCloudService(path, () => true)')
  expect(races).toContain('await service.share(writeRequest)')
  for (const [relative, module, name] of [
    ['orca-profiles/profile-cloud-session-mutation.ts', '/secure-file', 'writeSecureJsonFile'],
    ['artifacts/artifact-share-record-store.ts', '/secure-file', 'writeSecureJsonFile'],
    ['artifacts/artifact-cloud-service.ts', '/profile-index-store', 'ensureActiveOrcaProfile']
  ]) {
    const file = `src/main/${relative}`
    const producer = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
    expect(callsImportedRuntime(producer, module, name), file).toBe(true)
  }
  expect(NODE_RUNTIME_INCLUDE).not.toContain('src/shared/artifact-sharing-gate.test.ts')
})

it('runs the real cached esbuild service and import graph on its Node CLI host', () => {
  const owner = 'config/scripts/headless-detector-compiler-cache.test.mjs'
  const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
  for (const name of ['packCompilerCache', 'activateCompilerCache']) {
    expect(callsImportedRuntime(source, '/headless-detector-compiler-cache.mjs', name)).toBe(true)
  }
  expect(
    callsImportedRuntime(source, '/node-server-change-scope.mjs', 'collectNodeServerInputs')
  ).toBe(true)
  expect(callsImportedRuntime(source, '@orca/process-host', 'runProcessSync')).toBe(true)
  expect(source.text).toContain("vi.spyOn(childProcess, 'spawn')")
  expect(source.text).toContain('await compiler.stop()')
  expect(source.text).toContain('await service.drain')
  const action = readFileSync('.github/actions/prepare-headless-compiler/action.yml', 'utf8')
  for (const command of ['identity', 'activate', 'pack']) {
    expect(action).toContain(
      `run: node config/scripts/headless-detector-compiler-cache.mjs ${command}`
    )
  }
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  expect(NODE_RUNTIME_INCLUDE).not.toContain('config/scripts/node-server-change-scope.test.mjs')
})

it('runs real interrupted Git removal and durable-record cleanup on the Node host', () => {
  const owner = 'src/main/runtime/runtime-interrupted-local-worktree-removal.test.ts'
  const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
  for (const [module, name] of [
    ['/runtime-interrupted-local-worktree-removal', 'interruptedLocalWorktreeRemovalJob'],
    ['/worktree-removal-records', 'writeWorktreeRemovalRecords'],
    ['/worktree-background-removal', '_settlePendingWorktreeRemovalsForTests'],
    ['/windows-transient-lock-removal', 'removeTree']
  ]) {
    expect(callsImportedRuntime(source, module, name), name).toBe(true)
  }
  expect(source.text).toContain('promisify(execFile)')
  expect(source.text).toContain("await git(['worktree', 'add'")
  expect(source.text).toContain('vi.fn(actual.removeHostTree)')
  expect(source.text).not.toContain("vi.mock('../git/runner'")
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  expect(NODE_RUNTIME_INCLUDE).not.toContain('src/main/worktree-removal-home-guard.test.ts')
})

it('runs real quick-open ripgrep, junction and inventory-cap contracts in Node', () => {
  const owner = 'src/main/ipc/filesystem-quick-open-options.integration.test.ts'
  const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
  expect(callsImportedRuntime(source, '/filesystem-list-files', 'listQuickOpenFiles')).toBe(true)
  expect(
    callsImportedRuntime(source, '/filesystem-search-file-paths', 'searchQuickOpenFilePaths')
  ).toBe(true)
  expect(callsImportedRuntime(source, 'node:fs/promises', 'symlink')).toBe(true)
  expect(callsImportedRuntime(source, 'node:fs', 'writeFileSync')).toBe(true)
  expect(source.text).toContain("process.platform === 'win32' ? 'junction' : 'dir'")
  expect(source.text).toContain('20_020')
  expect(source.text).not.toContain('vi.mock(')
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  const mockOwner = 'src/main/ipc/filesystem-search-file-paths.test.ts'
  expect(readFileSync(mockOwner, 'utf8')).toContain("vi.mock('../git/runner'")
  expect(NODE_RUNTIME_INCLUDE).not.toContain(mockOwner)
})

it('runs Codex real-child deadline and exit observation in Node without moving mocked stop tests', () => {
  const owner = 'src/main/codex/codex-app-server-client.test.ts'
  const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
  expect(
    callsImportedRuntime(source, '/codex-app-server-client', 'runCodexHookTrustGrantSession')
  ).toBe(true)
  expect(
    callsImportedRuntime(source, '/codex-app-server-session', 'runCodexAppServerSession')
  ).toBe(true)
  expect(source.text).toContain('command: process.execPath')
  expect(source.text).toContain('process.kill(childPid, 0)')
  expect(source.text).toContain('STUB_START_DEADLINE_MS).toBeLessThan(2_000)')
  expect(source.text).not.toContain("vi.mock('./codex-app-server-process-tree-kill'")
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  const mockOwner = 'src/main/codex/codex-app-server-session-stop.test.ts'
  expect(readFileSync(mockOwner, 'utf8')).toContain(
    "vi.mock('./codex-app-server-process-tree-kill'"
  )
  expect(NODE_RUNTIME_INCLUDE).not.toContain(mockOwner)
})

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
}

it.each(['ssh-access-store', 'sidecar'])(
  'runs actual environment %s secure persistence in Node',
  (name) => {
    const owner = `src/shared/runtime-environment-${name}.test.ts`
    expect(
      callsImportedRuntime(
        source(owner),
        '/runtime-environment-store',
        'addEnvironmentFromPairingCode'
      )
    ).toBe(true)
    expect(
      callsImportedRuntime(
        source(owner),
        '/runtime-environment-ssh-access-store',
        'linkVerifiedRuntimeEnvironmentSshAccess'
      )
    ).toBe(true)
    expect(
      callsImportedRuntime(
        source('src/shared/runtime-environment-sidecar.ts'),
        '/bounded-secure-json-file',
        'writeSecureJsonFileWithinLimit'
      )
    ).toBe(true)
    expect(
      callsImportedRuntime(
        source('src/shared/bounded-secure-json-file.ts'),
        '/secure-file',
        'writeSecureFile'
      )
    ).toBe(true)
    expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  }
)

it('runs actual orcad lock privacy and stop ownership in Node', () => {
  const owner = 'src/main/orcad/orcad-lifecycle-host.test.ts'
  expect(callsImportedRuntime(source(owner), '/orcad-lifecycle', 'startOrcadWithHost')).toBe(true)
  expect(
    callsImportedRuntime(
      source('src/main/orcad/orcad-instance-lock.ts'),
      '/orcad-data-root-privacy',
      'assertOrcadDataRootIsPrivate'
    )
  ).toBe(true)
  expect(
    callsImportedRuntime(
      source('src/main/orcad/orcad-data-root-privacy.ts'),
      '/secure-path-windows-acl',
      'restrictWindowsPathSync'
    )
  ).toBe(true)
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
})

it('runs the native hook executable and real listener deadline in Node', () => {
  const owner = 'src/main/agent-hooks/windows-native-hook-exe-hosts.test.ts'
  const fixture = source(owner)
  expect(
    callsImportedRuntime(
      fixture,
      '/windows-native-hook-exe.test-fixture',
      'buildWindowsNativeHookExecutable'
    )
  ).toBe(true)
  expect(callsImportedRuntime(fixture, 'node:child_process', 'spawn')).toBe(true)
  expect(callsImportedRuntime(fixture, 'node:http', 'createServer')).toBe(true)
  expect(fixture.text).toContain("listen('never')")
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
})

it('runs actual untitled retention ACL and EEXIST refusal in Node', () => {
  const owner = 'src/main/ipc/filesystem/untitled-placeholder-handlers.test.ts'
  expect(
    callsImportedRuntime(
      source(owner),
      '/untitled-placeholder-handlers',
      'registerUntitledPlaceholderHandlers'
    )
  ).toBe(true)
  expect(
    callsImportedRuntime(
      source(owner),
      '/untitled-placeholder-recovery-directory',
      'resolveUntitledPlaceholderRetentionRoot'
    )
  ).toBe(true)
  expect(
    callsImportedRuntime(
      source('src/shared/untitled-placeholder-recovery-directory.ts'),
      '/secure-path-windows-acl',
      'restrictWindowsPathAsync'
    )
  ).toBe(true)
  expect(source(owner).text).toContain('EEXIST')
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
})

it('runs catalog real-child cancellation and exit observation in Node', () => {
  const owner = 'src/main/native-chat/agent-model-catalog/agent-model-catalog-probe-runner.test.ts'
  const fixture = source(owner)
  expect(
    callsImportedRuntime(
      fixture,
      '/agent-model-catalog-probe-runner',
      'runAgentModelCatalogListing'
    )
  ).toBe(true)
  expect(
    callsImportedRuntime(
      source('src/main/native-chat/agent-model-catalog/agent-model-catalog-probe-runner.ts'),
      '/managed-provider-process',
      'spawnManagedProviderProcess'
    )
  ).toBe(true)
  expect(fixture.text).toContain('command: process.execPath')
  expect(fixture.text).toContain('expect(isAlive(pid)).toBe(false)')
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  expect(NODE_RUNTIME_INCLUDE).not.toContain('src/shared/artifact-sharing-gate.test.ts')
  const mockOwner = 'src/main/native-chat/agent-model-catalog/agent-model-catalog-service.test.ts'
  expect(
    callsImportedRuntime(
      source(mockOwner),
      '/agent-model-catalog-service',
      'createAgentModelCatalogService'
    )
  ).toBe(true)
  expect(NODE_RUNTIME_INCLUDE).not.toContain(mockOwner)
})

it('keeps real durable runtime stores and lifecycle listeners on their Node host', () => {
  for (const [owner, module, name] of [
    [
      'src/main/ephemeral-vm-runtime-service.test.ts',
      '/ephemeral-vm-runtime-service',
      'provisionEphemeralVmRuntime'
    ],
    [
      'src/main/orcad/orcad-stop-request-listener.test.ts',
      '/orcad-stop-request-listener',
      'installOrcadStopRequestListeners'
    ],
    [
      'src/shared/ephemeral-vm-runtime-store-rollback.test.ts',
      '/ephemeral-vm-runtime-store',
      'upsertEphemeralVmRuntime'
    ],
    ['src/main/runtime/runtime-metadata.test.ts', '/runtime-metadata', 'writeRuntimeMetadata'],
    [
      'src/main/ssh/orcad-migration-cutover-journal.test.ts',
      '/orcad-migration-cutover-journal',
      'writeOrcadMigrationSourceCutover'
    ],
    [
      'src/shared/runtime-environment-managed-orcad-store.test.ts',
      '/runtime-environment-managed-orcad-store',
      'addManagedOrcadEnvironment'
    ]
  ]) {
    const fixture = source(owner)
    expect(callsImportedRuntime(fixture, module, name), owner).toBe(true)
    expect(fixture.text).not.toMatch(
      /vi\.mock\(['"][^'"]*(?:secure-file|bounded-secure-json-file|secure-path-windows-acl|ephemeral-vm-recipe-process)/
    )
    expect(NODE_RUNTIME_INCLUDE, owner).toContain(owner)
  }
  for (const [file, module, name] of [
    [
      'src/main/ephemeral-vm-runtime-service.ts',
      '/ephemeral-vm-recipe-runner',
      'runEphemeralVmRecipeStart'
    ],
    ['src/shared/ephemeral-vm-recipe-process.ts', 'node:child_process', 'spawn'],
    [
      'src/shared/ephemeral-vm-runtime-store.ts',
      '/bounded-secure-json-file',
      'writeSecureJsonFileWithinLimit'
    ],
    [
      'src/main/orcad/orcad-stop-request-listener.ts',
      '/orcad-managed-stop-decision',
      'claimOrcadManagedStopDecision'
    ],
    ['src/main/orcad/orcad-managed-stop-decision.ts', '/secure-file', 'writeDurableSecureJsonFile'],
    ['src/main/runtime/runtime-metadata.ts', '/secure-file', 'writeSecureJsonFile'],
    [
      'src/main/ssh/orcad-migration-cutover-journal.ts',
      '/bounded-secure-json-file',
      'writeSecureJsonFileWithinLimit'
    ],
    [
      'src/shared/runtime-environment-managed-orcad-store.ts',
      '/runtime-environment-sidecar',
      'writeRuntimeEnvironmentSidecarEntry'
    ],
    [
      'src/shared/runtime-environment-sidecar.ts',
      '/bounded-secure-json-file',
      'writeSecureJsonFileWithinLimit'
    ],
    ['src/shared/bounded-secure-json-file.ts', '/secure-file', 'writeSecureFile']
  ]) {
    expect(callsImportedRuntime(source(file), module, name), file).toBe(true)
  }
  for (const pure of [
    'src/shared/ephemeral-vm-recipes.test.ts',
    'src/shared/orcad-stop-request.test.ts',
    'src/shared/artifact-sharing-gate.test.ts',
    'src/shared/runtime-environments.test.ts'
  ]) {
    expect(NODE_RUNTIME_INCLUDE).not.toContain(pure)
  }
})

function callsImportedObject(
  fixture: ts.SourceFile,
  moduleSuffix: string,
  importedName: string,
  member?: string
): boolean {
  const bindings = new Set<string>()
  for (const node of fixture.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.endsWith(moduleSuffix) ||
      node.importClause?.isTypeOnly
    ) {
      continue
    }
    const named = node.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const binding of named.elements) {
        if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === importedName) {
          bindings.add(binding.name.text)
        }
      }
    }
  }
  let found = false
  const visit = (node: ts.Node): void => {
    if (member && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression
      found ||=
        ts.isIdentifier(receiver) &&
        bindings.has(receiver.text) &&
        node.expression.name.text === member
    } else if (!member && ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      found ||= bindings.has(node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(fixture)
  return found
}

it('keeps artifact response-loss recovery on real profile and secure-file persistence', () => {
  const owner = 'src/main/artifacts/artifact-cloud-recovery.test.ts'
  const fixture = source(owner)
  expect(callsImportedObject(fixture, '/artifact-cloud-service', 'ArtifactCloudService')).toBe(true)
  expect(fixture.text).toContain(
    'const restrictWindowsPath = windowsAcl.bestEffortRestrictWindowsPath'
  )
  expect(fixture.text).toContain('restrictWindowsPath(targetPath, isDirectory, (restricted) =>')
  expect(fixture.text).toContain('await Promise.all(pendingWindowsHardening)')
  expect(fixture.text).not.toMatch(
    /vi\.mock\(['"][^'"]*(?:secure-file|artifact-share-record-store)/
  )
  expect(
    callsImportedRuntime(
      source('src/main/artifacts/artifact-cloud-service.ts'),
      '/profile-index-store',
      'ensureActiveOrcaProfile'
    )
  ).toBe(true)
  expect(
    callsImportedRuntime(
      source('src/main/artifacts/artifact-share-record-store.ts'),
      '/secure-file',
      'writeSecureJsonFile'
    )
  ).toBe(true)
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
})

it('keeps WSL managed hook installation and its real grant host in Node', () => {
  const owner = 'src/main/codex/hook-service-wsl-runtime.test.ts'
  const fixture = source(owner)
  expect(
    callsImportedObject(fixture, '/hook-service', '_internals', 'installManagedHooksIntoWslRuntime')
  ).toBe(true)
  expect(
    callsImportedRuntime(
      source('src/main/codex/codex-hook-wsl-runtime.ts'),
      '/codex-hook-trust-grant',
      'grantManagedCodexHookTrust'
    )
  ).toBe(true)
  expect(fixture.text).toContain('trustGrantInternals.setGrantSessionRunner(runner)')
  expect(fixture.text).toContain('trustGrantInternals.setGrantSessionRunner(null)')
  expect(fixture.text).not.toMatch(
    /vi\.mock\(['"][^'"]*(?:codex-hook-trust-grant|codex-hook-wsl-runtime|secure-file)/
  )
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
})

it('keeps real ephemeral VM IPC recipe cancellation and secure persistence on Node', () => {
  const owner = 'src/main/ipc/ephemeral-vm.test.ts'
  const fixture = source(owner)
  expect(callsImportedRuntime(fixture, '/ephemeral-vm', 'registerEphemeralVmHandlers')).toBe(true)
  expect(
    callsImportedRuntime(fixture, '/ephemeral-vm-runtime-store', 'upsertEphemeralVmRuntime')
  ).toBe(true)
  expect(
    callsImportedRuntime(fixture, '/ephemeral-vm-native-test-fixture', 'drainNativeFixture')
  ).toBe(true)
  const memberCalls = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      memberCalls.add(`${node.expression.expression.text}.${node.expression.name.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(fixture)
  for (const name of ['actual.spawn', 'child.once', 'pendingChildren.add']) {
    expect(memberCalls).toContain(name)
  }
  expect(fixture.text).toContain('await importOriginal<typeof ChildProcess>()')
  expect(fixture.text).toContain("child.once('close', () => resolve())")
  expect(fixture.text).toContain('return child')
  expect(fixture.text.indexOf('await drainNativeFixture(pendingChildren)')).toBeLessThan(
    fixture.text.indexOf('rmSync(dir, { recursive: true, force: true })')
  )
  const drain = source('src/main/ipc/ephemeral-vm-native-test-fixture.ts')
  expect(drain.text).toContain(
    'const restrictWindowsPath = windowsAcl.bestEffortRestrictWindowsPath'
  )
  expect(drain.text).toContain('restrictWindowsPath(targetPath, isDirectory, (restricted) =>')
  expect(drain.text).toContain('onSettled?.(restricted)')
  expect(drain.text).toContain('await Promise.all(pendingChildren)')
  expect(drain.text).toContain('await Promise.all(pendingWindowsHardening)')
  const processOwner = source('src/shared/ephemeral-vm-recipe-process.ts')
  expect(callsImportedRuntime(processOwner, 'node:child_process', 'spawn')).toBe(true)
  expect(
    callsImportedRuntime(
      processOwner,
      '@orca/process-host/process-tree-kill-gate',
      'admitProcessTreeKill'
    )
  ).toBe(true)
  expect(processOwner.text).toContain('const spawnCommand = args.spawnCommand ?? spawn')
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  expect(NODE_RUNTIME_INCLUDE).not.toContain('src/shared/ephemeral-vm-recipes.test.ts')
  expect(NODE_RUNTIME_INCLUDE).not.toContain('src/shared/ephemeral-vm-recipe-checkout-mode.test.ts')
})
