import { globSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import ts from 'typescript-api'
import { expect, it } from 'vitest'
import { discoverUnitFiles } from './ci-unit-files.mjs'
import { NODE_RUNTIME_INCLUDE } from './vitest-node-runtime-files.mjs'

const sqliteHarnesses = new Set([
  'persistence-test-harness',
  'acknowledged-terminal-tab-retirement-fixture',
  'session-search-indexer-test-fixture',
  'agent-session-record-store-test-harness',
  'task-adapter.test-fixture',
  'journal-host-database-test-support',
  'orchestration-legacy-compatibility-dispatcher-test-fixture',
  'orchestration-mailbox-notification-test-harness',
  'provider-timeline-assembler-test-support',
  'structured-claude-scripted-runtime-test-support',
  'structured-chat-coordinator-mail-rig.test-fixture',
  'structured-agent-session-host-test-harness',
  'structured-agent-session-queued-message-rig.test-fixture',
  'structured-agent-session-rest-test-rig',
  'structured-agent-session-restart-interruption-test-harness',
  'session-scanner-opencode-sqlite-fixture',
  'persisted-profile-state'
])
const sqliteModules = new Set([
  resolve('src/main/sqlite/sync-database'),
  resolve('src/main/persistence/profile-state/profile-state-sqlite-authority'),
  resolve('src/main/native-chat/agent-session-journal/journal-host-database'),
  resolve('src/main/runtime/orchestration/db'),
  resolve('src/main/runtime/orchestration/db/orchestration-db'),
  resolve('src/main/runtime/structured-agent-session-runtime'),
  resolve('src/main/runtime/agent-session-record-store-slot')
])

/** Type-only names do not erase a default binding or an empty import's side effects. */
function importsSqliteRuntime(file: string, source: string): boolean {
  const module = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
  return module.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false
    }
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    if (
      clause?.isTypeOnly ||
      (!clause?.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((name) => name.isTypeOnly))
    ) {
      return false
    }
    return (
      sqliteHarnesses.has(
        basename(statement.moduleSpecifier.text).replace(/\.[cm]?[jt]sx?$/, '')
      ) ||
      sqliteModules.has(
        resolve(
          dirname(resolve(file)),
          statement.moduleSpecifier.text.replace(/\.[cm]?[jt]sx?$/, '')
        )
      )
    )
  })
}

it.each([
  ['import Database, { type Options } from "./sync-database"', true],
  ['import {} from "./sync-database"', true],
  ['import "./sync-database"', true],
  ['import { Database } from "./sync-database"', true],
  ['import * as Database from "./sync-database"', true],
  ['import type Database from "./sync-database"', false],
  ['import type { Options } from "./sync-database"', false],
  ['import { type Options } from "./sync-database"', false]
])('classifies the runtime dependency in %s', (source, runtime) => {
  expect(importsSqliteRuntime('src/main/sqlite/example.test.ts', source)).toBe(runtime)
})

it.each([...sqliteHarnesses])(
  'classifies the real %s fixture without admitting type-only or similarly named modules',
  (harness) => {
    expect(importsSqliteRuntime('example.test.ts', `import { create } from "./${harness}"`)).toBe(
      true
    )
    expect(importsSqliteRuntime('example.test.ts', `import type { Rig } from "./${harness}"`)).toBe(
      false
    )
    expect(importsSqliteRuntime('example.test.ts', `import { type Rig } from "./${harness}"`)).toBe(
      false
    )
    expect(
      importsSqliteRuntime('example.test.ts', `import { create } from "./${harness}-mock"`)
    ).toBe(false)
  }
)

it('classifies the real Paperclip task database fixture without classifying HTTP preparation or mocked storage', () => {
  const owner = 'config/scripts/paperclip-task-dispatch.test.mjs'
  expect(importsSqliteRuntime(owner, readFileSync(owner, 'utf8'))).toBe(true)
  for (const control of [
    'config/scripts/paperclip-workflow-prepare-dispatch.test.mjs',
    'config/scripts/paperclip-workflow-prepare-recovery-repository.test.mjs'
  ]) {
    expect(importsSqliteRuntime(control, readFileSync(control, 'utf8')), control).toBe(false)
  }
  const fixture = 'src/main/tasks/task-adapter.test-fixture.ts'
  expect(importsSqliteRuntime(fixture, readFileSync(fixture, 'utf8'))).toBe(true)
  expect(readFileSync(fixture, 'utf8')).toContain(
    'await openTestAgentSessionRecordStore(directory)'
  )
  expect(readFileSync(fixture, 'utf8')).toContain('closeTestJournalHostDatabase(directory)')
  expect(NODE_RUNTIME_INCLUDE).toContain(owner)
})

it('classifies the real profile authority value without admitting type-only or mock module imports', () => {
  const owner = 'src/main/runtime/example.test.ts'
  const module = '../persistence/profile-state/profile-state-sqlite-authority'
  expect(
    importsSqliteRuntime(owner, `import { ProfileStateSqliteAuthority } from "${module}"`)
  ).toBe(true)
  expect(
    importsSqliteRuntime(owner, `import type { ProfileStateSqliteAuthority } from "${module}"`)
  ).toBe(false)
  expect(
    importsSqliteRuntime(owner, `import { type ProfileStateSqliteAuthority } from "${module}"`)
  ).toBe(false)
  expect(
    importsSqliteRuntime(owner, `import { ProfileStateSqliteAuthority } from "${module}-mock"`)
  ).toBe(false)
})

it('keeps real acknowledged retirement and search-index fixtures in Node without replacing their databases', () => {
  for (const owner of [
    'src/main/runtime/acknowledged-terminal-tab-retirement.test.ts',
    'src/main/runtime/terminal-intentional-stop-exit.test.ts',
    'src/main/ai-vault/session-scanner-service-search-roots.test.ts',
    'src/main/ai-vault/session-scanner-service-search.test.ts'
  ]) {
    expect(importsSqliteRuntime(owner, readFileSync(owner, 'utf8')), owner).toBe(true)
    expect(NODE_RUNTIME_INCLUDE, owner).toContain(owner)
  }
  for (const fixture of [
    'src/main/runtime/acknowledged-terminal-tab-retirement-fixture.ts',
    'src/main/ai-vault-search/session-search-indexer-test-fixture.ts'
  ]) {
    expect(importsSqliteRuntime(fixture, readFileSync(fixture, 'utf8')), fixture).toBe(true)
  }
})

it('keeps real SQLite fixtures and database consumers in the Node runtime project', () => {
  const root = process.cwd()
  const nodeFiles = new Set(globSync(NODE_RUNTIME_INCLUDE).map((file) => resolve(root, file)))
  const missing: string[] = []
  for (const file of discoverUnitFiles(root)) {
    const source = readFileSync(resolve(root, file), 'utf8')
    if (
      ![...sqliteHarnesses].some((name) => source.includes(name)) &&
      !source.includes('sync-database') &&
      !source.includes('profile-state-sqlite-authority') &&
      !source.includes('journal-host-database') &&
      !source.includes('structured-agent-session-runtime') &&
      !source.includes('agent-session-record-store-slot') &&
      !source.includes('db')
    ) {
      continue
    }
    if (importsSqliteRuntime(file, source) && !nodeFiles.has(resolve(root, file))) {
      missing.push(file)
    }
  }
  expect(missing).toEqual([])
})
