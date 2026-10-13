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
