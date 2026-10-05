import * as fs from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexManagedAccount } from '../../shared/managed-account-types'
import { assertSynchronousAuthorization } from '../../shared/synchronous-authorization-guard'
import * as ownership from '../codex-accounts/host-codex-managed-home-ownership'
import {
  resolveSelectedTaskCodexAccountScope,
  resolveTaskCodexAccountScope,
  type TaskCodexAccountScopeDependencies
} from './task-codex-account-scope'

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof fs>()
  return { ...original, readFileSync: vi.fn(original.readFileSync) }
})

const UNAVAILABLE = 'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE'
const LOGS = 'logs/paperclip-development/p3/controlled-runtime/account-writer'
let directory: string

beforeEach(() => {
  const temporary = resolve(LOGS, 'tmp')
  fs.mkdirSync(temporary, { recursive: true })
  directory = fs.mkdtempSync(join(temporary, 'scope-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const account: CodexManagedAccount = {
    id: 'account-one',
    email: 'synthetic@example.invalid',
    managedHomePath: join(directory, 'managed', 'account-one', 'home'),
    managedHomeRuntime: 'host',
    providerAccountId: 'provider_one',
    createdAt: 1,
    updatedAt: 2,
    lastAuthenticatedAt: 2
  }
  const paths = {
    managedRoot: join(directory, 'managed'),
    systemHome: join(directory, 'system', '.codex')
  }
  fs.mkdirSync(account.managedHomePath, { recursive: true })
  fs.mkdirSync(paths.systemHome, { recursive: true })
  const marker = join(account.managedHomePath, '.orca-managed-home')
  fs.writeFileSync(marker, `${account.id}\n`, 'utf8')
  const settings: ReturnType<TaskCodexAccountScopeDependencies['getSettings']> = {
    codexManagedAccounts: [account],
    activeCodexManagedAccountId: account.id,
    activeCodexManagedAccountIdsByRuntime: { host: account.id, wsl: {} }
  }
  const getSettings = vi.fn(() => settings)
  const getManagedAccountsRoot = vi.fn(() => paths.managedRoot)
  const getSystemCodexHomePath = vi.fn(() => paths.systemHome)
  const dependencies: TaskCodexAccountScopeDependencies = {
    getSettings,
    getManagedAccountsRoot,
    getSystemCodexHomePath
  }
  const read = () => resolveTaskCodexAccountScope(dependencies, account.managedHomePath)
  return {
    account,
    settings,
    paths,
    marker,
    dependencies,
    read,
    getSettings,
    getManagedAccountsRoot,
    getSystemCodexHomePath
  }
}

describe('original selected host managed Codex account metadata', () => {
  it('resolves only the selected row, original provider ID and pinned home with real owned evidence', () => {
    const original = fixture()
    expect(
      ownership.resolveHostCodexManagedHomeVerdict({
        candidatePath: original.account.managedHomePath,
        managedAccountsRoot: original.paths.managedRoot,
        systemCodexHomePath: original.paths.systemHome,
        expectedAccountId: original.account.id
      }).kind
    ).toBe('owned')
    const before = structuredClone(original.settings)
    const bytes = fs.readFileSync(original.marker, 'utf8')
    const scope = original.read()
    expect(scope).toEqual({
      accountId: original.account.id,
      codexHome: original.account.managedHomePath,
      providerAccountId: original.account.providerAccountId,
      assertCurrent: expect.any(Function),
      assertMetadataCurrent: expect.any(Function)
    })
    expect(Object.isFrozen(scope)).toBe(true)
    expect(scope.assertCurrent()).toBeUndefined()
    expect(original.settings).toEqual(before)
    expect(fs.readFileSync(original.marker, 'utf8')).toBe(bytes)
    expect(original.getSettings).toHaveBeenCalledTimes(2)
  })
  it('keeps the original normalization rule for a legacy host selection', () => {
    const original = fixture()
    delete original.settings.activeCodexManagedAccountIdsByRuntime
    delete original.account.managedHomeRuntime
    expect(original.read().accountId).toBe(original.account.id)
  })
  it('resolves an explicit selected scope through the original host selection and full owned check', () => {
    const original = fixture()
    original.settings.activeCodexManagedAccountId = 'legacy-other-account'
    const helper = vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict')
    const before = structuredClone(original.settings)
    const scope = resolveSelectedTaskCodexAccountScope(original.dependencies)
    expect(scope.accountId).toBe(original.account.id)
    expect(scope.codexHome).toBe(original.account.managedHomePath)
    expect(scope.providerAccountId).toBe(original.account.providerAccountId)
    expect(Object.isFrozen(scope)).toBe(true)
    expect(helper).toHaveBeenCalledOnce()
    expect(original.getSettings).toHaveBeenCalledTimes(2)
    expect(original.settings).toEqual(before)
    expect(scope.assertMetadataCurrent()).toBeUndefined()
    expect(scope.assertCurrent()).toBeUndefined()
  })
  it('refuses an explicit selected scope with no host selection before owned-home I/O', () => {
    const original = fixture()
    original.settings.activeCodexManagedAccountId = null
    original.settings.activeCodexManagedAccountIdsByRuntime = { host: null, wsl: {} }
    const helper = vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict')
    const before = structuredClone(original.settings)
    expect(() => resolveSelectedTaskCodexAccountScope(original.dependencies)).toThrow(UNAVAILABLE)
    expect(helper).not.toHaveBeenCalled()
    expect(original.settings).toEqual(before)
  })
  it('refuses a changed selection between initial pinning and the full resolver even at the same home', () => {
    const original = fixture()
    original.getSettings.mockImplementationOnce(() => {
      const initial = structuredClone(original.settings)
      original.settings.codexManagedAccounts.push({ ...original.account, id: 'account-other' })
      original.settings.activeCodexManagedAccountIdsByRuntime = { host: 'account-other', wsl: {} }
      return initial
    })
    vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict').mockReturnValue({
      kind: 'owned',
      homePath: original.account.managedHomePath
    })
    expect(() => resolveSelectedTaskCodexAccountScope(original.dependencies)).toThrow(UNAVAILABLE)
    expect(original.getSettings).toHaveBeenCalledTimes(2)
  })
  it('uses the original by-runtime host selection before the legacy selected ID', () => {
    const original = fixture()
    original.settings.activeCodexManagedAccountId = 'legacy-other-account'
    expect(original.read().accountId).toBe(original.account.id)
  })
  it('ignores unrelated settings and row labels without reading mail, tokens or auth', () => {
    const original = fixture()
    Object.defineProperty(original.account, 'email', {
      get: () => {
        throw new Error('Mail is outside this narrow metadata read')
      }
    })
    Object.defineProperty(original.settings, 'unrelatedSecret', {
      get: () => {
        throw new Error('Unrelated settings must remain unread')
      }
    })
    const reads = vi.mocked(fs.readFileSync)
    reads.mockClear()
    const scope = original.read()
    expect(scope.assertCurrent()).toBeUndefined()
    expect(reads.mock.calls.length).toBeGreaterThan(0)
    expect(
      reads.mock.calls.every(([path]) => basename(String(path)) === '.orca-managed-home')
    ).toBe(true)
  })
  it('returns an immutable snapshot without retaining the live settings row', () => {
    const original = fixture()
    const scope = original.read()
    original.account.providerAccountId = 'provider_changed'
    original.account.id = 'account-changed'
    original.account.managedHomePath = join(directory, 'foreign-home')
    expect(scope.accountId).toBe('account-one')
    expect(scope.providerAccountId).toBe('provider_one')
    expect(scope.codexHome).toBe(join(directory, 'managed', 'account-one', 'home'))
    expect(() => Object.assign(scope, { providerAccountId: 'provider_changed' })).toThrow()
    expect(scope.assertCurrent).toThrow(UNAVAILABLE)
  })
  it('does not treat row freshness timestamps or workspace labels as account authority', () => {
    const original = fixture()
    const scope = original.read()
    original.account.lastAuthenticatedAt = 0
    original.account.updatedAt = 0
    original.account.workspaceAccountId = 'workspace-other'
    original.account.workspaceLabel = 'changed label'
    expect(scope.assertCurrent()).toBeUndefined()
    expect(Object.keys(scope).sort()).toEqual([
      'accountId',
      'assertCurrent',
      'assertMetadataCurrent',
      'codexHome',
      'providerAccountId'
    ])
  })
  it('supplies a synchronous currentness check without claiming a Host grant', () => {
    const original = fixture()
    const scope = original.read()
    expect(() =>
      assertSynchronousAuthorization(scope.assertCurrent, () => {
        throw new Error(UNAVAILABLE)
      })
    ).not.toThrow()
    expect('grant' in scope).toBe(false)
    expect('entitlement' in scope).toBe(false)
  })
  it('accepts the original provider ID character set at its exact 256 character limit', () => {
    const original = fixture()
    original.account.providerAccountId = `a-B_${'x'.repeat(252)}`
    expect(original.read().providerAccountId).toBe(original.account.providerAccountId)
  })

  type Fixture = ReturnType<typeof fixture>
  const invalid: [string, (original: Fixture) => void][] = [
    [
      'system-default selection',
      ({ settings }) => {
        settings.activeCodexManagedAccountId = null
        settings.activeCodexManagedAccountIdsByRuntime = { host: null, wsl: {} }
      }
    ],
    [
      'no selected row',
      ({ settings }) => {
        settings.codexManagedAccounts = []
      }
    ],
    [
      'selected row deleted',
      ({ settings }) => {
        settings.codexManagedAccounts.splice(0, 1)
      }
    ],
    [
      'duplicate ID',
      ({ settings, account }) => {
        settings.codexManagedAccounts.push({ ...account })
      }
    ],
    [
      'same ID in WSL',
      ({ settings, account }) => {
        settings.codexManagedAccounts.push({
          ...account,
          managedHomeRuntime: 'wsl',
          wslDistro: 'Ubuntu'
        })
      }
    ],
    [
      'selected WSL row',
      ({ account }) => {
        account.managedHomeRuntime = 'wsl'
        account.wslDistro = 'Ubuntu'
      }
    ],
    [
      'host row with WSL metadata',
      ({ account }) => {
        account.wslDistro = 'Ubuntu'
      }
    ],
    [
      'host row with Linux WSL home',
      ({ account }) => {
        account.wslLinuxHomePath = '/home/synthetic'
      }
    ],
    [
      'missing provider ID',
      ({ account }) => {
        delete account.providerAccountId
      }
    ],
    [
      'null provider ID',
      ({ account }) => {
        account.providerAccountId = null
      }
    ],
    [
      'empty provider ID',
      ({ account }) => {
        account.providerAccountId = ''
      }
    ],
    [
      'provider mail fallback',
      ({ account }) => {
        account.providerAccountId = 'synthetic@example.invalid'
      }
    ],
    [
      'provider whitespace',
      ({ account }) => {
        account.providerAccountId = ' provider_one'
      }
    ],
    [
      'provider trailing newline',
      ({ account }) => {
        account.providerAccountId = 'provider_one\n'
      }
    ],
    [
      'provider over limit',
      ({ account }) => {
        account.providerAccountId = 'a'.repeat(257)
      }
    ],
    [
      'relative home',
      ({ account }) => {
        account.managedHomePath = 'relative/home'
      }
    ],
    [
      'empty home',
      ({ account }) => {
        account.managedHomePath = ''
      }
    ],
    [
      'NUL home',
      ({ account }) => {
        account.managedHomePath += '\0'
      }
    ],
    [
      'UNC home',
      ({ account }) => {
        account.managedHomePath = '\\\\server\\managed\\account-one\\home'
      }
    ],
    [
      'WSL UNC home',
      ({ account }) => {
        account.managedHomePath = '\\\\wsl.localhost\\Ubuntu\\home\\synthetic'
      }
    ],
    [
      'overlong home',
      ({ account }) => {
        account.managedHomePath = resolve(directory, 'x'.repeat(4096))
      }
    ],
    [
      'relative managed root',
      ({ paths }) => {
        paths.managedRoot = 'relative/root'
      }
    ],
    [
      'UNC managed root',
      ({ paths }) => {
        paths.managedRoot = '//server/managed'
      }
    ],
    [
      'relative system home',
      ({ paths }) => {
        paths.systemHome = 'relative/system'
      }
    ],
    [
      'system home candidate',
      ({ paths, account }) => {
        account.managedHomePath = paths.systemHome
      }
    ],
    [
      'outside storage root',
      ({ paths }) => {
        paths.managedRoot = join(directory, 'other-root')
      }
    ],
    [
      'missing home',
      ({ account }) => {
        fs.rmSync(account.managedHomePath, { recursive: true })
      }
    ],
    [
      'missing marker',
      ({ marker }) => {
        fs.rmSync(marker)
      }
    ],
    [
      'foreign marker',
      ({ marker }) => {
        fs.writeFileSync(marker, 'account-other\n')
      }
    ],
    [
      'malformed runtime',
      ({ account }) => {
        Object.assign(account, { managedHomeRuntime: 'other' })
      }
    ],
    [
      'malformed registry',
      ({ settings }) => {
        Object.assign(settings, { codexManagedAccounts: null })
      }
    ],
    [
      'malformed row',
      ({ settings }) => {
        Object.assign(settings, { codexManagedAccounts: [null] })
      }
    ],
    [
      'malformed selection',
      ({ settings }) => {
        Object.assign(settings, { activeCodexManagedAccountIdsByRuntime: [] })
      }
    ]
  ]
  it.each(invalid)(
    'refuses %s without repairing selection or creating a scope',
    (_label, mutate) => {
      const original = fixture()
      mutate(original)
      const before = structuredClone(original.settings)
      expect(original.read).toThrow(UNAVAILABLE)
      expect(original.settings).toEqual(before)
    }
  )

  const drift: [string, (original: Fixture) => void][] = [
    [
      'selection',
      ({ settings }) => {
        settings.activeCodexManagedAccountIdsByRuntime = { host: 'account-other', wsl: {} }
      }
    ],
    [
      'selection removed',
      ({ settings }) => {
        settings.activeCodexManagedAccountIdsByRuntime = { host: null, wsl: {} }
        settings.activeCodexManagedAccountId = null
      }
    ],
    [
      'deleted row',
      ({ settings }) => {
        settings.codexManagedAccounts = []
      }
    ],
    [
      'duplicate row',
      ({ settings, account }) => {
        settings.codexManagedAccounts.push({ ...account })
      }
    ],
    [
      'provider ID',
      ({ account }) => {
        account.providerAccountId = 'provider_other'
      }
    ],
    [
      'row ID',
      ({ account }) => {
        account.id = 'account-other'
      }
    ],
    [
      'home',
      ({ account }) => {
        account.managedHomePath = join(directory, 'other-home')
      }
    ],
    [
      'root',
      ({ paths }) => {
        paths.managedRoot = join(directory, 'other-root')
      }
    ],
    [
      'system home',
      ({ paths }) => {
        paths.systemHome = join(directory, 'new-system-home')
      }
    ],
    [
      'WSL runtime',
      ({ account }) => {
        account.managedHomeRuntime = 'wsl'
      }
    ],
    [
      'marker removed',
      ({ marker }) => {
        fs.rmSync(marker)
      }
    ],
    [
      'ownership lost',
      ({ marker }) => {
        fs.writeFileSync(marker, 'account-other\n')
      }
    ]
  ]
  it.each(drift)(
    'synchronously refuses current %s drift without changing the pinned snapshot',
    (_label, mutate) => {
      const original = fixture()
      const scope = original.read()
      const snapshot = { ...scope }
      mutate(original)
      expect(scope.assertCurrent).toThrow(UNAVAILABLE)
      if (_label !== 'marker removed' && _label !== 'ownership lost') {
        expect(scope.assertMetadataCurrent).toThrow(UNAVAILABLE)
      }
      expect(scope).toEqual(snapshot)
    }
  )
  it('accepts a new live row object with the same original account identity', () => {
    const original = fixture()
    const scope = original.read()
    original.settings.codexManagedAccounts = [{ ...original.account }]
    expect(scope.assertCurrent()).toBeUndefined()
  })
  it('does not revoke the host scope for an unrelated WSL selection change', () => {
    const original = fixture()
    const scope = original.read()
    original.settings.activeCodexManagedAccountIdsByRuntime = {
      host: original.account.id,
      wsl: { ubuntu: 'account-other' }
    }
    expect(scope.assertCurrent()).toBeUndefined()
  })
  it('rejects a root junction retargeting while the original metadata paths stay the same', () => {
    const original = fixture()
    const alias = join(directory, 'current-managed')
    const otherRoot = join(directory, 'other-managed')
    const otherHome = join(otherRoot, original.account.id, 'home')
    fs.mkdirSync(otherHome, { recursive: true })
    fs.writeFileSync(join(otherHome, '.orca-managed-home'), original.account.id)
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    fs.symlinkSync(original.paths.managedRoot, alias, kind)
    original.paths.managedRoot = alias
    original.account.managedHomePath = join(alias, original.account.id, 'home')
    const scope = original.read()
    fs.unlinkSync(alias)
    fs.symlinkSync(otherRoot, alias, kind)
    expect(
      ownership.resolveHostCodexManagedHomeVerdict({
        candidatePath: original.account.managedHomePath,
        managedAccountsRoot: alias,
        systemCodexHomePath: original.paths.systemHome,
        expectedAccountId: original.account.id
      }).kind
    ).toBe('owned')
    expect(scope.assertCurrent).toThrow(UNAVAILABLE)
  })
  it('rejects a pinned home belonging to another row without using that row or the selected fallback', () => {
    const original = fixture()
    const other = {
      ...original.account,
      id: 'account-other',
      managedHomePath: join(directory, 'managed', 'account-other', 'home')
    }
    fs.mkdirSync(other.managedHomePath, { recursive: true })
    fs.writeFileSync(join(other.managedHomePath, '.orca-managed-home'), other.id)
    original.settings.codexManagedAccounts.push(other)
    expect(() =>
      resolveTaskCodexAccountScope(original.dependencies, other.managedHomePath)
    ).toThrow(UNAVAILABLE)
  })
  it.each(['getSettings', 'getManagedAccountsRoot', 'getSystemCodexHomePath'] as const)(
    'sanitizes original %s errors during lookup and current checks',
    (key) => {
      const original = fixture()
      const scope = original.read()
      original[key].mockImplementation(() => {
        throw new Error(`private-account-path:${directory}`)
      })
      expect(scope.assertCurrent).toThrow(/^TASK_MODEL_AUTH_SCOPE_UNAVAILABLE$/)
      expect(original.read).toThrow(/^TASK_MODEL_AUTH_SCOPE_UNAVAILABLE$/)
      expect(() => resolveSelectedTaskCodexAccountScope(original.dependencies)).toThrow(
        /^TASK_MODEL_AUTH_SCOPE_UNAVAILABLE$/
      )
    }
  )
  it('refuses a pending settings getter as malformed metadata', () => {
    const original = fixture()
    const scope = original.read()
    Object.assign(original.dependencies, { getSettings: () => Promise.resolve(original.settings) })
    expect(scope.assertCurrent).toThrow(UNAVAILABLE)
    expect(original.read).toThrow(UNAVAILABLE)
    expect(() => resolveSelectedTaskCodexAccountScope(original.dependencies)).toThrow(UNAVAILABLE)
  })
  it('refuses a pending ownership result even when it carries owned-looking fields', () => {
    const original = fixture()
    const scope = original.read()
    const value = { kind: 'owned' as const, homePath: original.account.managedHomePath }
    const pending = Object.assign(Promise.resolve(value), value)
    const outcome = { value }
    Object.assign(outcome, { value: pending })
    vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict').mockImplementation(
      () => outcome.value
    )
    expect(scope.assertCurrent).toThrow(UNAVAILABLE)
    expect(original.read).toThrow(UNAVAILABLE)
  })
  it('checks metadata for every stream event without repeating owned-home file I/O', () => {
    const original = fixture()
    const helper = vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict')
    const reads = vi.mocked(fs.readFileSync)
    reads.mockClear()
    const scope = original.read()
    expect(helper).toHaveBeenCalledOnce()
    reads.mockClear()
    for (let event = 0; event < 128; event += 1) {
      expect(scope.assertMetadataCurrent()).toBeUndefined()
    }
    expect(helper).toHaveBeenCalledOnce()
    expect(reads).not.toHaveBeenCalled()
    expect(scope.assertCurrent()).toBeUndefined()
    expect(helper).toHaveBeenCalledTimes(2)
    expect(reads).toHaveBeenCalledOnce()
  })
  it('keeps owned proof on the full check while metadata currentness grants no ownership', () => {
    const original = fixture()
    const scope = original.read()
    fs.rmSync(original.marker)
    const helper = vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict')
    expect(scope.assertMetadataCurrent()).toBeUndefined()
    expect(helper).not.toHaveBeenCalled()
    expect(scope.assertCurrent).toThrow(UNAVAILABLE)
    expect(helper).toHaveBeenCalledOnce()
  })
  it('rechecks selected row deletion through metadata without running the full helper', () => {
    const original = fixture()
    const scope = original.read()
    original.settings.codexManagedAccounts = []
    const helper = vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict')
    expect(scope.assertMetadataCurrent).toThrow(UNAVAILABLE)
    expect(helper).not.toHaveBeenCalled()
  })
  it('does not issue an initial metadata scope when the original owned verdict is unavailable', () => {
    const original = fixture()
    vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict').mockReturnValue({
      kind: 'untrusted',
      reason: 'synthetic missing owner'
    })
    expect(original.read).toThrow(UNAVAILABLE)
  })
  it.each(['untrusted', 'indeterminate', 'malformed', 'pending', 'throw'])(
    'refuses an original ownership verdict of %s',
    (mode) => {
      const original = fixture()
      const scope = original.read()
      const verdict = vi.spyOn(ownership, 'resolveHostCodexManagedHomeVerdict')
      if (mode === 'untrusted') {
        verdict.mockReturnValue({ kind: 'untrusted', reason: `private-account:${directory}` })
      } else if (mode === 'indeterminate') {
        verdict.mockReturnValue({
          kind: 'indeterminate',
          error: new Error(`private-account:${directory}`)
        })
      } else if (mode === 'throw') {
        verdict.mockImplementation(() => {
          throw new Error(`private-account:${directory}`)
        })
      } else if (mode === 'pending') {
        const outcome = {
          value: { kind: 'owned' as const, homePath: original.account.managedHomePath }
        }
        Object.assign(outcome, { value: Promise.resolve(outcome.value) })
        verdict.mockImplementation(() => outcome.value)
      } else {
        const outcome = {
          value: { kind: 'owned' as const, homePath: original.account.managedHomePath }
        }
        Object.assign(outcome.value, { homePath: null })
        verdict.mockImplementation(() => outcome.value)
      }
      expect(scope.assertCurrent).toThrow(/^TASK_MODEL_AUTH_SCOPE_UNAVAILABLE$/)
      expect(original.read).toThrow(/^TASK_MODEL_AUTH_SCOPE_UNAVAILABLE$/)
    }
  )
})
