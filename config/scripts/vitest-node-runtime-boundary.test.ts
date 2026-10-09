import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript-api'
import { expect, it } from 'vitest'
import { discoverUnitFiles } from './ci-unit-files.mjs'
import { NODE_RUNTIME_INCLUDE } from './vitest-node-runtime-files.mjs'

it('keeps loader hooks and real Windows credential/pipe owners in the Node project', () => {
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [
    'config/scripts/client-build-execution.test.mjs',
    'config/scripts/check-hivecode-brand-boundary.test.mjs',
    'config/scripts/client-build-ios-signature.darwin.test.mjs',
    'config/scripts/client-build-ios.test.mjs',
    'config/scripts/managed-data-account-runtime.test.ts',
    'src/main/provisioned-root-ssh-adoption.test.ts',
    'src/main/cursor/hook-service.test.ts',
    'src/main/startup/run-electron-vite-dev-web.test.ts',
    'src/main/providers/agent-foreground-process-git-bash.win32.test.ts',
    'src/main/providers/hive-native-foreground.win32.test.ts',
    'tests/e2e/cross-version-wire/agent-session-death-evidence-downgrade.unit.test.ts',
    'tests/e2e/cross-version-wire/kept-card-downgrade.unit.test.ts',
    'tests/e2e/cross-version-wire/session-search-agent-set-downgrade.unit.test.ts',
    'src/main/native-chat/agent-session-wire/structured-agent-session-queued-repeat-press.test.ts',
    'src/main/ai-vault-search/session-search-index-pass.test.ts'
  ]) {
    expect(nodeFiles.has(owner), owner).toBe(true)
  }
})

it('keeps real native ACL writes in Node while leaving mock-only notification and secret-store siblings in their project', () => {
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [
    'src/main/opencode/opencode-go-api-key-store.test.ts',
    'src/main/ipc/notifications-subject-retirement.test.ts'
  ]) {
    expect(NODE_RUNTIME_INCLUDE, owner).toContain(owner)
    expect(nodeFiles.has(owner), owner).toBe(true)
  }
  for (const owner of [
    'src/main/ipc/notifications-message-formatting.test.ts',
    'src/shared/secret-store.test.ts'
  ]) {
    expect(nodeFiles.has(owner), owner).toBe(false)
    expect(readFileSync(owner, 'utf8')).not.toContain('configureDismissalStore')
    expect(readFileSync(owner, 'utf8')).not.toContain('writeSecureFile')
  }
})

function hasValueImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) {
    return true
  }
  if (clause.isTypeOnly) {
    return false
  }
  return (
    !!clause.name ||
    !clause.namedBindings ||
    ts.isNamespaceImport(clause.namedBindings) ||
    clause.namedBindings.elements.length === 0 ||
    clause.namedBindings.elements.some((binding) => !binding.isTypeOnly)
  )
}

function importsNodeHttpRuntime(source: ts.SourceFile): boolean {
  return source.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      hasValueImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'node:http'
  )
}

it.each([
  ['import { createServer, type Server } from "node:http"', true],
  ['import type { Server } from "node:http"', false],
  ['import { type Server } from "node:http"', false],
  ['import { createServer } from "node:http-mock"', false]
])('distinguishes the native HTTP value dependency in %s', (source, value) => {
  expect(
    importsNodeHttpRuntime(ts.createSourceFile('example.ts', source, ts.ScriptTarget.Latest))
  ).toBe(value)
})

it('keeps the real Hive Web Launch HTTP listener in Node without moving its mock-only control sibling', () => {
  const actual = 'src/main/hive-runtime-cloud/hive-runtime-cloud-web-launch-service.test.ts'
  const mockOnly =
    'src/main/hive-runtime-cloud/hive-runtime-cloud-web-session-control-service.test.ts'
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [actual, mockOnly]) {
    const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    expect(importsNodeHttpRuntime(source), owner).toBe(owner === actual)
    expect(nodeFiles.has(owner), owner).toBe(owner === actual)
  }
  const source = ts.createSourceFile(actual, readFileSync(actual, 'utf8'), ts.ScriptTarget.Latest)
  const calls = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text)
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calls.add(node.expression.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const operation of ['createServer', 'listen', 'closeAllConnections', 'close']) {
    expect(calls.has(operation), operation).toBe(true)
  }
})

function importsWorkflowPrepareFixture(source: ts.SourceFile): boolean {
  return source.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      hasValueImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith('/local-task-workflow-prepare.test-fixture.ts')
  )
}

it.each([
  ['import { workflowPrepareFixture } from "./local-task-workflow-prepare.test-fixture.ts"', true],
  ['import type { Rig } from "./local-task-workflow-prepare.test-fixture.ts"', false],
  ['import { type Rig } from "./local-task-workflow-prepare.test-fixture.ts"', false]
])('distinguishes the HTTP fixture value dependency in %s', (source, value) => {
  expect(
    importsWorkflowPrepareFixture(
      ts.createSourceFile('example.mjs', source, ts.ScriptTarget.Latest)
    )
  ).toBe(value)
})

it('keeps the real Paperclip preparation HTTP lifecycle in Node without moving mock-only controls', () => {
  const actual = 'config/scripts/paperclip-workflow-prepare-dispatch.test.mjs'
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [
    actual,
    'config/scripts/paperclip-workflow-prepare-recovery-repository.test.mjs',
    'config/scripts/paperclip-external-execution-control.test.mjs'
  ]) {
    const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    expect(importsWorkflowPrepareFixture(source), owner).toBe(owner === actual)
    expect(nodeFiles.has(owner), owner).toBe(owner === actual)
  }
  const fixture = 'src/main/tasks/local-task-workflow-prepare.test-fixture.ts'
  const source = ts.createSourceFile(fixture, readFileSync(fixture, 'utf8'), ts.ScriptTarget.Latest)
  expect(
    source.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === './local-task-workflow-prepare-service.test-fixture'
    )
  ).toBe(true)
  const serviceFile = 'src/main/tasks/local-task-workflow-prepare-service.test-fixture.ts'
  const service = ts.createSourceFile(
    serviceFile,
    readFileSync(serviceFile, 'utf8'),
    ts.ScriptTarget.Latest
  )
  expect(
    service.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:http'
    )
  ).toBe(true)
  const calls = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text)
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'service'
      ) {
        calls.add(`service.${node.expression.name.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(service)
  for (const call of ['createServer', 'service.closeAllConnections', 'service.close']) {
    expect(calls.has(call), call).toBe(true)
  }
  expect(NODE_RUNTIME_INCLUDE).toContain(actual)
})

function importsNodePtyRuntime(source: ts.SourceFile): boolean {
  let importsPty = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      hasValueImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'node-pty'
    ) {
      importsPty = true
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'node-pty'
    ) {
      importsPty = true
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return importsPty
}

function importsZshPtyFixture(source: ts.SourceFile): boolean {
  return source.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      hasValueImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith('/zsh-startup-hook-pty-harness')
  )
}

it.each([
  ['import * as pty from "node-pty"', true],
  ['import { spawn, type IPty } from "node-pty"', true],
  ['const pty = await import("node-pty")', true],
  ['import type { IPty } from "node-pty"', false],
  ['import { type IPty } from "node-pty"', false],
  ['type IPty = import("node-pty").IPty', false],
  ['vi.mock("node-pty", () => ({ spawn: vi.fn() }))', false],
  ['const pty = await import("node-pty-mock")', false]
])('distinguishes the native PTY value dependency in %s', (source, value) => {
  expect(
    importsNodePtyRuntime(ts.createSourceFile('example.ts', source, ts.ScriptTarget.Latest))
  ).toBe(value)
})

it.each([
  ['import { runZshPty } from "./zsh-startup-hook-pty-harness"', true],
  ['import type { ZshPtyRun } from "./zsh-startup-hook-pty-harness"', false],
  ['import { type ZshPtyRun } from "./zsh-startup-hook-pty-harness"', false],
  ['vi.mock("./zsh-startup-hook-pty-harness", () => ({ runZshPty: vi.fn() }))', false]
])('distinguishes the real zsh PTY fixture value dependency in %s', (source, value) => {
  expect(
    importsZshPtyFixture(ts.createSourceFile('example.ts', source, ts.ScriptTarget.Latest))
  ).toBe(value)
})

it('keeps the real shell-ready and feature-channel PTYs in Node without moving scanner or injected Job controls', () => {
  const direct = 'src/main/daemon/shell-ready.test.ts'
  const fixtureConsumer = 'src/main/shell-startup-feature-channel.test.ts'
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [
    direct,
    fixtureConsumer,
    'src/main/shell-startup-output-scanner.test.ts',
    'src/main/windows/windows-pty-job.test.ts'
  ]) {
    const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    expect(importsNodePtyRuntime(source), owner).toBe(owner === direct)
    expect(importsZshPtyFixture(source), owner).toBe(owner === fixtureConsumer)
    expect(nodeFiles.has(owner), owner).toBe(owner === direct || owner === fixtureConsumer)
    expect(NODE_RUNTIME_INCLUDE.includes(owner), owner).toBe(
      owner === direct || owner === fixtureConsumer
    )
  }
  const fixture = 'src/main/zsh-startup-hook-pty-harness.ts'
  const source = ts.createSourceFile(fixture, readFileSync(fixture, 'utf8'), ts.ScriptTarget.Latest)
  expect(importsNodePtyRuntime(source), fixture).toBe(true)
  const calls = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      calls.add(node.expression.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const operation of ['spawn', 'onData', 'onExit', 'write', 'kill']) {
    expect(calls.has(operation), operation).toBe(true)
  }
})

it('keeps real dynamic node-pty spawning in Node while leaving injected Job mocks in Bun', () => {
  const actual = 'src/main/windows/windows-msys-job.win32.test.ts'
  const control = 'src/main/windows/windows-pty-job.test.ts'
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [actual, control]) {
    const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    const dynamicPtyImport = importsNodePtyRuntime(source)
    let ptySpawn = false
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'pty' &&
        node.expression.name.text === 'spawn'
      ) {
        ptySpawn = true
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(dynamicPtyImport, owner).toBe(owner === actual)
    expect(ptySpawn, owner).toBe(owner === actual)
    expect(nodeFiles.has(owner), owner).toBe(owner === actual)
  }
  const mock = ts.createSourceFile(control, readFileSync(control, 'utf8'), ts.ScriptTarget.Latest)
  expect(
    mock.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        !hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node-pty'
    )
  ).toBe(true)
  expect(readFileSync(control, 'utf8')).toContain('__setConptyJobNativeForTests')
  expect(NODE_RUNTIME_INCLUDE).toContain(actual)
})

it('keeps Node entrypoint resolution and real directory lifetimes in Node without moving mocked cwd checks', () => {
  for (const owner of [
    'config/scripts/client-build-install.test.mjs',
    'src/main/daemon/daemon-pty-adapter-history-recovery.test.ts',
    'src/main/skills/skill-freshness-inventory.test.ts',
    'src/main/daemon/terminal-host.test.ts'
  ]) {
    expect(NODE_RUNTIME_INCLUDE, owner).toContain(owner)
  }
  for (const owner of [
    'config/scripts/client-build-artifacts.test.mjs',
    'src/main/daemon/terminal-host-cwd-readability.test.ts'
  ]) {
    expect(NODE_RUNTIME_INCLUDE, owner).not.toContain(owner)
  }
  const installer = 'config/scripts/client-build-install.mjs'
  const source = ts.createSourceFile(
    installer,
    readFileSync(installer, 'utf8'),
    ts.ScriptTarget.Latest
  )
  expect(
    source.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:module'
    )
  ).toBe(true)
  expect(readFileSync(installer, 'utf8')).toContain('require.resolve(specifier)')
  for (const producer of [
    'src/main/daemon/directory-enumeration-probe.ts',
    'src/main/skills/skill-plugin-cache-scan.ts'
  ]) {
    const module = ts.createSourceFile(
      producer,
      readFileSync(producer, 'utf8'),
      ts.ScriptTarget.Latest
    )
    expect(
      module.statements.some(
        (node) =>
          ts.isImportDeclaration(node) &&
          hasValueImport(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === 'node:fs/promises'
      ),
      producer
    ).toBe(true)
    const awaitedCalls = new Set<string>()
    const collectCall = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          awaitedCalls.add(node.expression.text)
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          awaitedCalls.add(node.expression.name.text)
        }
      }
      ts.forEachChild(node, collectCall)
    }
    const visit = (node: ts.Node): void => {
      if (ts.isAwaitExpression(node)) {
        collectCall(node.expression)
      }
      ts.forEachChild(node, visit)
    }
    visit(module)
    for (const method of ['opendir', 'read', 'close']) {
      expect(awaitedCalls.has(method), `${producer}: ${method}`).toBe(true)
    }
  }
  expect(readFileSync('src/main/skills/skill-freshness-inventory.test.ts', 'utf8')).toContain(
    "await execFileAsync('git'"
  )
  expect(readFileSync('src/main/daemon/terminal-host-cwd-readability.test.ts', 'utf8')).toContain(
    "vi.mock('node:fs/promises'"
  )
})

it('keeps the actual private recovery FD and native ACL contract in Node', () => {
  const owner = 'src/shared/untitled-placeholder-recovery-directory.test.ts'
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
  const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
  expect(
    source.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === './untitled-placeholder-recovery-directory'
    )
  ).toBe(true)
  const producer = readFileSync('src/shared/untitled-placeholder-recovery-directory.ts', 'utf8')
  expect(producer).toContain('await restrictWindowsPathAsync(root, true)')
  expect(readFileSync(owner, 'utf8')).toContain("await open(filePath, 'r+')")
})

it('keeps real SQLite fixtures and publication durability in Node without moving JSON parsers', () => {
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [
    'src/main/opencode-usage/cache-write-accounting.test.ts',
    'src/main/ai-vault/session-scanner.test.ts',
    'src/main/ipc/ai-vault-search-all-hosts-real-index.test.ts',
    'src/main/runtime/terminal-retirement-async-durability.test.ts',
    'src/main/ipc/pty/pane/pane-owner-replacement.test.ts',
    'src/main/startup/profile-state-recovery-preflight.test.ts',
    'src/main/runtime/structured-worker-cleared-session.test.ts',
    'src/main/window/history-gc-profile-worktree-ids.test.ts',
    'src/main/runtime/orchestration/structured-session-mail-target.test.ts'
  ]) {
    expect(NODE_RUNTIME_INCLUDE, owner).toContain(owner)
    expect(nodeFiles.has(owner), owner).toBe(true)
  }
  for (const owner of [
    'src/main/ipc/ai-vault-search-all-hosts.test.ts',
    'src/main/ai-vault/session-scanner-opencode-parser.test.ts',
    'src/main/ai-vault/session-scanner-codex-parser.test.ts'
  ]) {
    expect(nodeFiles.has(owner), owner).toBe(false)
  }
  for (const producer of [
    'src/main/opencode-usage/opencode-usage-sqlite-fixture.ts',
    'src/main/ai-vault/session-scanner-opencode-sqlite-fixture.ts',
    'src/main/persistence/profile-state/profile-state-database.ts',
    'src/main/runtime/orchestration/db/orchestration-db.ts'
  ]) {
    const module = ts.createSourceFile(
      producer,
      readFileSync(producer, 'utf8'),
      ts.ScriptTarget.Latest
    )
    expect(
      module.statements.some(
        (node) =>
          ts.isImportDeclaration(node) &&
          hasValueImport(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.endsWith('/sqlite/sync-database')
      ),
      producer
    ).toBe(true)
  }
})

it('keeps real baseline Git object checks in Node and mocked drift probes in Bun', () => {
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  const actualOwner = 'tests/e2e/cross-version-wire/structured-agent-baseline.unit.test.ts'
  for (const owner of [actualOwner, 'src/main/git/repo-remote-drift.test.ts']) {
    const module = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    const importsNativeGitProcess = module.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:child_process'
    )
    expect(importsNativeGitProcess, owner).toBe(owner === actualOwner)
    expect(nodeFiles.has(owner), owner).toBe(owner === actualOwner)
  }
})

it('keeps the real native Codex shell lifecycle in Node without classifying wrapper construction and staging', () => {
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  const nativeOwner = 'src/main/pty/codex-shell-no-daemon.test.ts'
  expect(NODE_RUNTIME_INCLUDE).toContain(nativeOwner)
  for (const owner of [
    nativeOwner,
    'src/main/pty/codex-launch-shell-wrapping.test.ts',
    'src/shared/startup-command-staging.test.ts'
  ]) {
    const module = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    const importsNativeProcess = module.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:child_process'
    )
    expect(importsNativeProcess, owner).toBe(owner === nativeOwner)
    expect(nodeFiles.has(owner), owner).toBe(owner === nativeOwner)
  }
})

it('keeps real mobile-store native hardening in Node while leaving a mocked device registry consumer in Bun', () => {
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  const nativeOwner = 'src/main/runtime/mobile-store-orphaned-temp-cleanup.test.ts'
  expect(NODE_RUNTIME_INCLUDE).toContain(nativeOwner)
  for (const owner of [nativeOwner, 'src/main/runtime/rpc/mobile-socket-wiring.test.ts']) {
    const module = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    const importsStoreValue = module.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.endsWith('/device-registry')
    )
    expect(importsStoreValue, owner).toBe(owner === nativeOwner)
    expect(nodeFiles.has(owner), owner).toBe(owner === nativeOwner)
  }
})

it('keeps real loader imports in Node without classifying mock-only client builders', () => {
  const root = process.cwd()
  const nodeFiles = new Set(globSync(NODE_RUNTIME_INCLUDE).map((file) => resolve(root, file)))
  const consumers: string[] = []
  for (const file of discoverUnitFiles(root)) {
    const source = readFileSync(resolve(root, file), 'utf8')
    if (!source.includes('client-build-execution') && !source.includes('registerHooks')) {
      continue
    }
    const module = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
    let requiresLoader = false
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text
        requiresLoader ||= specifier.endsWith('/client-build-execution.mjs')
        const bindings = node.importClause?.namedBindings
        requiresLoader ||=
          specifier === 'node:module' &&
          !!bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some(
            (binding) =>
              !binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 'registerHooks'
          )
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'vi' &&
        node.expression.name.text === 'importActual' &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.endsWith('/client-build-execution.mjs')
      ) {
        requiresLoader = true
      }
      ts.forEachChild(node, visit)
    }
    visit(module)
    if (requiresLoader) {
      consumers.push(file)
      expect(nodeFiles.has(resolve(root, file)), file).toBe(true)
    }
  }
  expect(consumers).toContain('config/scripts/check-hivecode-brand-boundary.test.mjs')
  expect(consumers).toContain('config/scripts/client-build-ios.test.mjs')
  expect(consumers).not.toContain('config/scripts/client-build-android.test.mjs')
  expect(consumers).not.toContain('config/scripts/client-build-artifacts.test.mjs')
  expect(consumers).not.toContain('config/scripts/client-build-desktop-headers.test.mjs')
  expect(consumers).not.toContain('config/scripts/client-build-desktop-packaging.test.mjs')
})

it('runs Node runtime contracts in Node even when the coordinator uses Bun', () => {
  expect(process.versions.bun).toBeUndefined()
  expect(process.release.name).toBe('node')
  expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(24)
})

function isGlobalThis(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isGlobalThis(expression.expression)
  }
  return ts.isIdentifier(expression) && expression.text === 'globalThis'
}

it('keeps exposed-GC heap measurements in the Node runtime project', () => {
  const root = process.cwd()
  const nodeFiles = new Set(globSync(NODE_RUNTIME_INCLUDE).map((file) => resolve(root, file)))
  const missing: string[] = []
  for (const file of discoverUnitFiles(root)) {
    if (nodeFiles.has(resolve(root, file))) {
      continue
    }
    const source = readFileSync(resolve(root, file), 'utf8')
    if (!source.includes('heapUsed') || !source.includes('gc')) {
      continue
    }
    const module = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
    let usesGlobalGc = false
    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertyAccessExpression(node) &&
          node.name.text === 'gc' &&
          isGlobalThis(node.expression)) ||
        (ts.isElementAccessExpression(node) &&
          ts.isStringLiteral(node.argumentExpression) &&
          node.argumentExpression.text === 'gc' &&
          isGlobalThis(node.expression))
      ) {
        usesGlobalGc = true
      }
      ts.forEachChild(node, visit)
    }
    visit(module)
    if (usesGlobalGc) {
      missing.push(file)
    }
  }
  expect(missing).toEqual([])
})

it('runs real OS account-home protection in Node without moving mocked or parser-only consumers', () => {
  const nativeOwner = 'config/scripts/vitest-real-agent-home-write-guard.test.ts'
  expect(NODE_RUNTIME_INCLUDE).toContain(nativeOwner)
  for (const owner of [
    nativeOwner,
    'src/main/runtime/rpc/mobile-socket-wiring.test.ts',
    'src/main/ai-vault/session-scanner-opencode-parser.test.ts'
  ]) {
    const module = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    const importsRealAccountHome = module.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:os' &&
        !!node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(
          (binding) =>
            !binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 'userInfo'
        )
    )
    expect(importsRealAccountHome, owner).toBe(owner === nativeOwner)
    expect(NODE_RUNTIME_INCLUDE.includes(owner), owner).toBe(owner === nativeOwner)
  }
})

it('runs real native setup and hook child-process contracts in Node while keeping pure quoting controls in Bun', () => {
  const consumers = [
    'src/shared/setup-agent-sequencing.test.ts',
    'src/shared/setup-agent-sequencing.windows.test.ts',
    'src/main/agent-hooks/managed-hook-stdin-lifecycle.test.ts'
  ]
  for (const owner of [
    ...consumers,
    'src/shared/child-process/windows-command-line.test.ts',
    'src/shared/windows-command-line-budget.test.ts'
  ]) {
    const module = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    const importsNativeSpawn = module.statements.some(
      (node) =>
        ts.isImportDeclaration(node) &&
        hasValueImport(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:child_process' &&
        !!node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(
          (binding) =>
            !binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 'spawn'
        )
    )
    expect(importsNativeSpawn, owner).toBe(consumers.includes(owner))
    expect(NODE_RUNTIME_INCLUDE.includes(owner), owner).toBe(consumers.includes(owner))
  }
})

function callsImportedRuntime(
  source: ts.SourceFile,
  moduleSuffix: string,
  importedName: string
): boolean {
  const bindings = new Set<string>()
  for (const node of source.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !hasValueImport(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.endsWith(moduleSuffix)
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
  let called = false
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      called ||= bindings.has(node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return called
}

it.each([
  ['import { run } from "./runtime"; run({})', true],
  ['import { run as spawn } from "./runtime"; spawn({})', true],
  ['import type { run } from "./runtime"', false],
  ['import { type run } from "./runtime"', false],
  ['import { run } from "./runtime"', false]
])('requires a called runtime value import in %s', (text, called) => {
  expect(
    callsImportedRuntime(
      ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest),
      '/runtime',
      'run'
    )
  ).toBe(called)
})

it('runs the real daemon exec PTY in Node while preserving mocked spawn consumers in Bun', () => {
  const actual = 'src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts'
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [
    actual,
    'src/main/daemon/pty-subprocess.test.ts',
    'src/main/daemon/pty-subprocess-cwd-cancel-identity.test.ts'
  ]) {
    const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    expect(callsImportedRuntime(source, '/pty-subprocess', 'createPtySubprocess'), owner).toBe(true)
    expect(source.text.includes("vi.mock('node-pty'"), owner).toBe(owner !== actual)
    expect(nodeFiles.has(owner), owner).toBe(owner === actual)
    expect(NODE_RUNTIME_INCLUDE.includes(owner), owner).toBe(owner === actual)
  }
  const facade = 'src/main/daemon/pty-subprocess.ts'
  expect(
    callsImportedRuntime(
      ts.createSourceFile(facade, readFileSync(facade, 'utf8'), ts.ScriptTarget.Latest),
      '/native-pty-spawn',
      'spawnNativeDaemonPty'
    )
  ).toBe(true)
  const native = 'src/main/daemon/pty-subprocess/native-pty-spawn.ts'
  expect(
    importsNodePtyRuntime(
      ts.createSourceFile(native, readFileSync(native, 'utf8'), ts.ScriptTarget.Latest)
    )
  ).toBe(true)
})

it('runs actual pinned Node Pack builders in Node while retaining notice-only controls in Bun', () => {
  const consumers = [
    'config/scripts/managed-pi-cloud-host.test.ts',
    'config/scripts/managed-pi-execution-host.test.ts',
    'config/scripts/managed-pi-pack-build.test.ts',
    'config/scripts/managed-pi-process.test.ts',
    'config/scripts/managed-pi-text-runtime.test.ts'
  ]
  const nodeFiles = new Set(
    globSync(NODE_RUNTIME_INCLUDE).map((file) => file.replaceAll('\\', '/'))
  )
  for (const owner of [...consumers, 'config/scripts/managed-pi-pack-notices.test.ts']) {
    const source = ts.createSourceFile(owner, readFileSync(owner, 'utf8'), ts.ScriptTarget.Latest)
    expect(
      callsImportedRuntime(source, '/managed-pi-pack-producer', 'produceManagedPiTextPack'),
      owner
    ).toBe(consumers.includes(owner))
    expect(nodeFiles.has(owner), owner).toBe(consumers.includes(owner))
    expect(NODE_RUNTIME_INCLUDE.includes(owner), owner).toBe(consumers.includes(owner))
  }
})
