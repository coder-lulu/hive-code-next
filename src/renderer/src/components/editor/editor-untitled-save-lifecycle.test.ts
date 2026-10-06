import type { StoreApi } from 'zustand/vanilla'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import { ORCA_EDITOR_SAVE_AND_CLOSE_EVENT } from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import {
  createFakeEditorDisk,
  createUntitledNoteStore,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'
import { discardEditorFileChangesAndClose } from './discard-editor-file-changes'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { getDiskBaselineSignature } from './diff-content-signature'
import { createEditorSaveQueue } from './editor-save-queue'
import { registerPendingEditorFlush } from './editor-pending-flush'

const storeHolder = vi.hoisted((): { store: StoreApi<AppState> | null } => ({ store: null }))

function requireStore(): StoreApi<AppState> {
  if (!storeHolder.store) {
    throw new Error('test store not initialised')
  }
  return storeHolder.store
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => requireStore().getState() } }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: vi.fn() }))

import {
  captureEditorFileOperationProvenance,
  getEditorFileOperationContext
} from '@/lib/editor-file-operation-owner'
import {
  replaceRuntimeEnvironmentRevisions,
  getRuntimeEnvironmentRevision
} from '@/runtime/runtime-environment-revision'
import {
  getRuntimeEnvironmentConnectionGeneration,
  setRuntimeEnvironmentConnectionGenerationForTests
} from '@/store/slices/runtime-status'
import { clearRuntimeCompatibilityCacheForTests } from '@/runtime/runtime-rpc-client'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '@/runtime/runtime-compatibility-test-fixture'

import {
  mkdir as mkdirActual,
  mkdtemp as mkdtempActual,
  readFile as readActual,
  realpath as realpathActual,
  rm as rmActual,
  writeFile as writeActual
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUntitledPlaceholderRetentionHost } from '../../../../shared/untitled-placeholder-retention'

const FILE_ID = '/repo/untitled.md'

function typeInto(store: StoreApi<AppState>, content: string): void {
  store.getState().setEditorDraft(FILE_ID, content)
  store.getState().markFileDirty(FILE_ID, true)
}

/** What the editor panel records after a clean (re)load of the tab shows `content` from disk. */
function loadFromDisk(store: StoreApi<AppState>, content: string): void {
  store.getState().setLastKnownDiskSignature(FILE_ID, getDiskBaselineSignature(content))
}

function isReopenable(store: StoreApi<AppState>): boolean {
  return (store.getState().recentlyClosedEditorTabsByWorktree['wt-1'] ?? []).some(
    (tab) => tab.filePath === FILE_ID
  )
}

describe('untitled note save lifecycle', () => {
  let disk: FakeEditorDisk
  let store: StoreApi<AppState>

  beforeEach(() => {
    // Why: the window stub binds setTimeout, so fake timers must be installed first for autosave to be drivable.
    vi.useFakeTimers()
    disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [FILE_ID]: '' }))
    store = createUntitledNoteStore('untitled.md')
    storeHolder.store = store
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    storeHolder.store = null
  })

  it.each([
    ['before its empty content loads', (): void => {}],
    ['after its empty content loads', (): void => loadFromDisk(store, '')]
  ])('preserves an untouched untitled note closed %s', async (_when, load) => {
    load()

    store.getState().closeFile(FILE_ID)

    await vi.advanceTimersByTimeAsync(0)
    expect(disk.files.get(FILE_ID)).toBe('')
    expect(disk.fs.deletePath).not.toHaveBeenCalled()
    expect(isReopenable(store)).toBe(true)
  })

  it.each([
    [
      'Save in the unsaved-changes prompt',
      async (): Promise<void> => {
        window.dispatchEvent(
          new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId: FILE_ID } })
        )
        await vi.waitFor(() => expect(store.getState().openFiles).toHaveLength(0))
      }
    ],
    [
      'autosave, then a plain close',
      async (): Promise<void> => {
        await vi.advanceTimersByTimeAsync(1500)
        store.getState().closeFile(FILE_ID)
      }
    ]
  ])('keeps the typed note after %s', async (_route, saveAndClose) => {
    loadFromDisk(store, '')
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto(store, 'my note')

      await saveAndClose()
      await vi.advanceTimersByTimeAsync(0)

      expect(store.getState().openFiles).toHaveLength(0)
      expect(disk.files.get(FILE_ID)).toBe('my note')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
      expect(isReopenable(store)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('preserves the note when its last save emptied it', async () => {
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto(store, 'a')
      await vi.advanceTimersByTimeAsync(1500)
      typeInto(store, '')
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.files.get(FILE_ID)).toBe('')

      store.getState().closeFile(FILE_ID)

      await vi.advanceTimersByTimeAsync(0)
      expect(disk.files.get(FILE_ID)).toBe('')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
      expect(isReopenable(store)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("keeps autosaved content when Don't Save interrupts the in-flight write", async () => {
    loadFromDisk(store, '')
    let finishWrite: () => void = () => {}
    disk.fs.writeFile.mockImplementationOnce(
      ({ filePath, content }: { filePath: string; content: string }) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            disk.files.set(filePath, content)
            resolve()
          }
        })
    )
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto(store, 'my note')
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.fs.writeFile).toHaveBeenCalledTimes(1)

      const discarded = discardEditorFileChangesAndClose(FILE_ID)
      finishWrite()
      await discarded
      await vi.advanceTimersByTimeAsync(0)

      expect(store.getState().openFiles).toHaveLength(0)
      expect(disk.files.get(FILE_ID)).toBe('my note')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it.each([
    ['while its tab showed the new text', true],
    ['while its tab was in the background', false]
  ])('keeps a note an agent wrote into %s', async (_when, reloaded) => {
    loadFromDisk(store, '')
    disk.files.set(FILE_ID, 'agent text')
    if (reloaded) {
      loadFromDisk(store, 'agent text')
    }

    store.getState().closeFile(FILE_ID)

    await vi.advanceTimersByTimeAsync(0)
    expect(disk.files.get(FILE_ID)).toBe('agent text')
    expect(disk.fs.deletePath).not.toHaveBeenCalled()
    expect(isReopenable(store)).toBe(true)
  })

  it('keeps a replacement tab draft and lease when an older save finishes', async () => {
    loadFromDisk(store, '')
    typeInto(store, 'saved from the old tab')
    let finishWrite!: () => void
    disk.fs.writeFile.mockImplementationOnce(
      ({ filePath, content }) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            disk.files.set(filePath, content)
            resolve()
          }
        })
    )
    const queue = createEditorSaveQueue(store)
    const oldFile = store.getState().openFiles[0]!
    try {
      const saved = queue.queueSave(oldFile, 'saved from the old tab')
      await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
      const baseline = getDiskBaselineSignature('replacement disk content')
      store.setState({
        openFiles: [
          {
            ...oldFile,
            untitledPlaceholderLeaseToken: 'replacement-lease',
            lastKnownDiskSignature: baseline
          }
        ],
        editorDrafts: { [FILE_ID]: 'saved from the old tab' }
      })
      finishWrite()
      await saved
      expect(store.getState().openFiles[0]?.untitledPlaceholderLeaseToken).toBe('replacement-lease')
      expect(store.getState().openFiles[0]?.isDirty).toBe(true)
      expect(store.getState().openFiles[0]?.lastKnownDiskSignature).toBe(baseline)
      expect(store.getState().editorDrafts[FILE_ID]).toBe('saved from the old tab')
      expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: FILE_ID,
          leaseToken: oldFile.untitledPlaceholderLeaseToken
        })
      )
    } finally {
      queue.dispose()
    }
  })

  it('does not close a replacement draft after Save and Close completes for an older tab', async () => {
    const settings = store.getState().settings
    if (!settings) {
      throw new Error('The editor test settings were not initialized')
    }
    store.setState({ settings: { ...settings, editorAutoSave: false } })
    loadFromDisk(store, '')
    typeInto(store, 'old tab content')
    let finishWrite!: () => void
    disk.fs.writeFile.mockImplementationOnce(
      ({ filePath, content }) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            disk.files.set(filePath, content)
            resolve()
          }
        })
    )
    const cleanup = attachEditorAutosaveController(store)
    try {
      window.dispatchEvent(
        new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId: FILE_ID } })
      )
      await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
      store.setState({
        openFiles: [
          {
            ...store.getState().openFiles[0]!,
            untitledPlaceholderLeaseToken: 'replacement-lease',
            isDirty: true
          }
        ],
        editorDrafts: { [FILE_ID]: 'old tab content' }
      })
      finishWrite()
      await vi.waitFor(() => expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(0)
      expect(store.getState().openFiles).toHaveLength(1)
      expect(store.getState().openFiles[0]?.untitledPlaceholderLeaseToken).toBe('replacement-lease')
      expect(store.getState().openFiles[0]?.isDirty).toBe(true)
      expect(store.getState().editorDrafts[FILE_ID]).toBe('old tab content')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it.each(['lease-unavailable', 'lease-owner-mismatch', 'path-mismatch'])(
    'keeps the open draft when placeholder discard refuses %s',
    async (reason) => {
      loadFromDisk(store, '')
      typeInto(store, 'unsaved draft')
      disk.fs.discardUntitledPlaceholder.mockResolvedValueOnce({ status: 'unavailable', reason })
      await expect(discardEditorFileChangesAndClose(FILE_ID)).rejects.toThrow('no longer valid')
      expect(store.getState().openFiles).toHaveLength(1)
      expect(store.getState().openFiles[0]?.isDirty).toBe(true)
      expect(store.getState().editorDrafts[FILE_ID]).toBe('unsaved draft')
      expect(disk.files.get(FILE_ID)).toBe('')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
    }
  )

  it('keeps edits when their rich-editor flush fails during discard', async () => {
    loadFromDisk(store, '')
    typeInto(store, 'unsaved draft')
    const unregisterFlush = registerPendingEditorFlush(FILE_ID, () => {
      throw new Error('Cannot serialize draft')
    })
    const cleanup = attachEditorAutosaveController(store)
    try {
      await expect(discardEditorFileChangesAndClose(FILE_ID)).rejects.toThrow(
        'Cannot serialize draft'
      )
      expect(store.getState().openFiles).toHaveLength(1)
      expect(store.getState().openFiles[0]?.isDirty).toBe(true)
      expect(store.getState().editorDrafts[FILE_ID]).toBe('unsaved draft')
      expect(disk.fs.writeFile).not.toHaveBeenCalled()
      expect(disk.fs.discardUntitledPlaceholder).not.toHaveBeenCalled()
      expect(disk.files.get(FILE_ID)).toBe('')
    } finally {
      cleanup()
      unregisterFlush()
    }
  })

  it('keeps newer edits entered while the host processes discard', async () => {
    loadFromDisk(store, '')
    typeInto(store, 'old draft')
    disk.fs.discardUntitledPlaceholder.mockImplementationOnce(async () => {
      typeInto(store, 'new draft')
      return { status: 'preserved', reason: 'not-empty' }
    })
    await expect(discardEditorFileChangesAndClose(FILE_ID)).rejects.toThrow(
      'changed while discarding'
    )
    expect(store.getState().editorDrafts[FILE_ID]).toBe('new draft')
    expect(store.getState().openFiles).toHaveLength(1)
    expect(store.getState().openFiles[0]?.isDirty).toBe(true)
    expect(disk.files.get(FILE_ID)).toBe('')
  })

  it("removes a never-saved note's placeholder on Don't Save", async () => {
    loadFromDisk(store, '')
    typeInto(store, 'typed but never saved')

    await discardEditorFileChangesAndClose(FILE_ID)

    expect(store.getState().openFiles).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(disk.files.has(FILE_ID)).toBe(false)
    expect(disk.fs.discardUntitledPlaceholder).toHaveBeenCalledTimes(1)
    expect(disk.fs.deletePath).not.toHaveBeenCalled()
    expect(isReopenable(store)).toBe(false)
    expect(store.getState().editorDrafts[FILE_ID]).toBeUndefined()
  })

  function configureAuthorityOnlyChange(
    change: 'ssh-generation' | 'owner-graph' | 'runtime-pairing' | 'runtime-connection'
  ) {
    const originalWorktree = store.getState().worktreesByRepo['repo-1'][0]!
    const ssh = {
      targetId: 'generation-only-ssh',
      status: 'connected' as const,
      error: null,
      reconnectAttempt: 0,
      connectionGeneration: 7
    }
    store.setState({
      sshConnectionStates: new Map([[ssh.targetId, ssh]]),
      sshStateByEnvironment: new Map()
    })
    if (change === 'owner-graph') {
      return () =>
        store.setState({
          worktreesByRepo: {
            'repo-1': [{ ...originalWorktree, hostId: 'ssh:generation-only-ssh' }]
          }
        })
    }
    if (change === 'ssh-generation') {
      store.setState({
        worktreesByRepo: { 'repo-1': [{ ...originalWorktree, hostId: 'ssh:generation-only-ssh' }] }
      })
      return () =>
        store.setState({
          sshConnectionStates: new Map([[ssh.targetId, { ...ssh, connectionGeneration: 8 }]])
        })
    }
    const environment = {
      id: 'generation-only-env',
      name: 'generation-only-env',
      createdAt: 1,
      updatedAt: 7,
      pairingRevision: 7,
      lastUsedAt: null,
      runtimeId: 'generation-only-runtime',
      preferredEndpointId: 'endpoint',
      endpoints: [
        {
          id: 'endpoint',
          kind: 'websocket' as const,
          label: 'fixture',
          endpoint: 'ws://fixture.invalid'
        }
      ]
    }
    replaceRuntimeEnvironmentRevisions([environment])
    setRuntimeEnvironmentConnectionGenerationForTests(environment.id, 7)
    store.setState({
      runtimeEnvironments: [environment],
      worktreesByRepo: {
        'repo-1': [
          {
            ...originalWorktree,
            hostId: 'runtime:generation-only-env',
            runtimeOwnerEnvironmentId: environment.id
          }
        ]
      }
    })
    Object.assign(window.api, {
      runtimeEnvironments: {
        call: vi.fn(async (request: RuntimeEnvironmentCallRequest) => {
          const compatible = createCompatibleRuntimeStatusResponseIfNeeded(request)
          if (compatible) {
            return compatible
          }
          if (request.method === 'files.write') {
            const content = request.params?.content
            if (typeof content !== 'string') {
              throw new Error('Fixture write requires actual text')
            }
            await window.api.fs.writeFile({ filePath: FILE_ID, content })
          } else if (request.method === 'files.releaseUntitledPlaceholder') {
            const leaseToken = request.params?.leaseToken
            if (typeof leaseToken !== 'string' || !window.api.fs.releaseUntitledPlaceholder) {
              throw new Error('Fixture release requires the actual lease API and token')
            }
            await window.api.fs.releaseUntitledPlaceholder({
              filePath: FILE_ID,
              leaseToken
            })
          } else {
            throw new Error('Unexpected authority regression RPC')
          }
          return {
            id: 'fixture',
            ok: true,
            result: undefined,
            _meta: { runtimeId: 'remote-runtime' }
          }
        })
      }
    })
    return change === 'runtime-pairing'
      ? () => replaceRuntimeEnvironmentRevisions([{ ...environment, pairingRevision: 8 }])
      : () => setRuntimeEnvironmentConnectionGenerationForTests(environment.id, 8)
  }

  it.each([
    ['queue', 'ssh-generation', true],
    ['queue', 'ssh-generation', false],
    ['queue', 'owner-graph', true],
    ['queue', 'owner-graph', false],
    ['queue', 'runtime-pairing', true],
    ['queue', 'runtime-pairing', false],
    ['queue', 'runtime-connection', true],
    ['queue', 'runtime-connection', false],
    ['SaveClose', 'ssh-generation', true],
    ['SaveClose', 'ssh-generation', false],
    ['SaveClose', 'owner-graph', true],
    ['SaveClose', 'owner-graph', false],
    ['SaveClose', 'runtime-pairing', true],
    ['SaveClose', 'runtime-pairing', false],
    ['SaveClose', 'runtime-connection', true],
    ['SaveClose', 'runtime-connection', false]
  ] as const)(
    'retains unchanged file/draft/lease for %s after only %s changes, stored provenance %s',
    async (route, change, storedProvenance) => {
      const settings = store.getState().settings
      if (!settings) {
        throw new Error('Fixture settings unavailable')
      }
      store.setState({ settings: { ...settings, editorAutoSave: false } })
      clearRuntimeCompatibilityCacheForTests()
      const mutateAuthority = configureAuthorityOnlyChange(change)
      const captured = captureEditorFileOperationProvenance(
        store.getState(),
        'wt-1',
        undefined,
        false
      )
      store.setState({
        openFiles: store.getState().openFiles.map((file) => ({
          ...file,
          runtimeEnvironmentId: captured.generation.route.runtimeEnvironmentId,
          operationProvenance: storedProvenance ? captured : undefined
        }))
      })
      loadFromDisk(store, '')
      typeInto(store, 'identical unsaved draft')
      const beforeFile = store.getState().openFiles[0]!
      const beforeDraft = store.getState().editorDrafts[FILE_ID]
      const beforeContext = getEditorFileOperationContext(
        store.getState(),
        { ...beforeFile, operationProvenance: captured },
        '/repo'
      )
      expect(beforeContext.expectedSshConnectionGeneration).toBe(
        change === 'ssh-generation' ? 7 : undefined
      )
      let finishWrite!: () => void
      disk.fs.writeFile.mockImplementationOnce(
        ({ filePath, content }: { filePath: string; content: string }) =>
          new Promise<void>((resolve) => {
            finishWrite = () => {
              disk.files.set(filePath, content)
              resolve()
            }
          })
      )
      const queue = route === 'queue' ? createEditorSaveQueue(store) : null
      const cleanup = route === 'SaveClose' ? attachEditorAutosaveController(store) : () => {}
      try {
        const pending = queue?.queueSave(beforeFile, beforeDraft!)
        const refusal = pending ? expect(pending).rejects.toThrow() : null
        if (route === 'SaveClose') {
          window.dispatchEvent(
            new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId: FILE_ID } })
          )
        }
        await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
        mutateAuthority()
        expect(store.getState().openFiles[0]).toBe(beforeFile)
        expect(store.getState().editorDrafts[FILE_ID]).toBe(beforeDraft)
        if (change === 'runtime-pairing') {
          expect(getRuntimeEnvironmentRevision('generation-only-env')).toBe(8)
        }
        if (change === 'runtime-connection') {
          expect(getRuntimeEnvironmentConnectionGeneration('generation-only-env')).toBe(8)
        }
        expect(() =>
          getEditorFileOperationContext(
            store.getState(),
            { ...beforeFile, operationProvenance: captured },
            '/repo'
          )
        ).toThrow()
        finishWrite()
        if (refusal) {
          await refusal
        }
        await vi.waitFor(() => expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledTimes(1))
        await vi.advanceTimersByTimeAsync(0)
        const afterFile = store.getState().openFiles[0]!
        expect(store.getState().openFiles).toHaveLength(1)
        expect(afterFile.filePath).toBe(beforeFile.filePath)
        expect(afterFile.operationProvenance).toBe(beforeFile.operationProvenance)
        expect(afterFile.untitledPlaceholderLeaseToken).toBe(
          beforeFile.untitledPlaceholderLeaseToken
        )
        expect(afterFile.lastKnownDiskSignature).toBe(beforeFile.lastKnownDiskSignature)
        expect(afterFile.isDirty).toBe(true)
        expect(store.getState().editorDrafts[FILE_ID]).toBe(beforeDraft)
        expect(disk.files.get(FILE_ID)).toBe('identical unsaved draft')
        expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledWith(
          expect.objectContaining({
            filePath: FILE_ID,
            leaseToken: beforeFile.untitledPlaceholderLeaseToken
          })
        )
        expect(disk.fs.deletePath).not.toHaveBeenCalled()
      } finally {
        cleanup()
        queue?.dispose()
        replaceRuntimeEnvironmentRevisions([])
        setRuntimeEnvironmentConnectionGenerationForTests('generation-only-env', 0)
        clearRuntimeCompatibilityCacheForTests()
      }
    }
  )

  it('does not let a queued old request write into a same-id tab with a new token and provenance', async () => {
    loadFromDisk(store, '')
    typeInto(store, 'old request text')
    let finishWrite!: () => void
    disk.fs.writeFile.mockImplementationOnce(
      ({ filePath, content }: { filePath: string; content: string }) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            disk.files.set(filePath, content)
            resolve()
          }
        })
    )
    const queue = createEditorSaveQueue(store)
    const originalFile = store.getState().openFiles[0]!
    try {
      const first = queue.queueSave(originalFile, 'old request text')
      await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
      const queued = queue.queueSave(originalFile, 'old queued text')
      const refusal = expect(queued).rejects.toThrow('queued editor file was replaced')
      const replacementProvenance = captureEditorFileOperationProvenance(
        store.getState(),
        'wt-1',
        undefined,
        false
      )
      store.setState({
        openFiles: [
          {
            ...originalFile,
            untitledPlaceholderLeaseToken: 'new-tab-lease',
            operationProvenance: replacementProvenance
          }
        ],
        editorDrafts: { [FILE_ID]: 'new tab draft' }
      })
      finishWrite()
      await first
      await refusal
      expect(disk.fs.writeFile).toHaveBeenCalledTimes(1)
      expect(store.getState().openFiles[0]?.untitledPlaceholderLeaseToken).toBe('new-tab-lease')
      expect(store.getState().openFiles[0]?.operationProvenance).toBe(replacementProvenance)
      expect(store.getState().editorDrafts[FILE_ID]).toBe('new tab draft')
      expect(store.getState().openFiles[0]?.isDirty).toBe(true)
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
    } finally {
      queue.dispose()
    }
  })

  it('saves a newer queued draft after the preceding save consumes the same-tab lease', async () => {
    const settings = store.getState().settings
    if (!settings) {
      throw new Error('Fixture settings unavailable')
    }
    store.setState({ settings: { ...settings, editorAutoSave: false } })
    loadFromDisk(store, '')
    typeInto(store, 'first draft')
    let finishWrite!: () => void
    disk.fs.writeFile.mockImplementationOnce(
      ({ filePath, content }: { filePath: string; content: string }) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            disk.files.set(filePath, content)
            resolve()
          }
        })
    )
    const queue = createEditorSaveQueue(store)
    const firstFile = store.getState().openFiles[0]!
    const token = firstFile.untitledPlaceholderLeaseToken
    expect(typeof token).toBe('string')
    try {
      const first = queue.queueSave(firstFile, 'first draft')
      await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
      typeInto(store, 'newer queued draft')
      const queuedFile = store.getState().openFiles[0]!
      expect(queuedFile.operationProvenance).toBe(firstFile.operationProvenance)
      expect(queuedFile.untitledPlaceholderLeaseToken).toBe(token)
      const second = queue.queueSave(queuedFile, 'newer queued draft')
      // Attach immediately so the existing regression does not create an unhandled rejection.
      const completion = Promise.all([first, second])
      const rejectionHandled = completion.catch((error) => error)
      finishWrite()
      expect(await rejectionHandled).toEqual([undefined, undefined])
      expect(disk.fs.writeFile).toHaveBeenCalledTimes(2)
      expect(disk.files.get(FILE_ID)).toBe('newer queued draft')
      expect(store.getState().openFiles).toHaveLength(1)
      expect(store.getState().openFiles[0]?.untitledPlaceholderLeaseToken).toBeUndefined()
      expect(store.getState().openFiles[0]?.isDirty).toBe(false)
      expect(store.getState().editorDrafts[FILE_ID]).toBeUndefined()
      expect(store.getState().openFiles[0]?.lastKnownDiskSignature).toBe(
        getDiskBaselineSignature('newer queued draft')
      )
      expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledTimes(1)
      expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: FILE_ID, leaseToken: token })
      )
      expect(disk.fs.discardUntitledPlaceholder).not.toHaveBeenCalled()
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
    } finally {
      queue.dispose()
    }
  })

  it('consumes a genuinely released in-flight saved lease before Dont Save and keeps the actual file', async () => {
    const directory = await realpathActual(
      await mkdtempActual(join(tmpdir(), 'editor-quiesce-real-lease-'))
    )
    const recoveryRoot = join(directory, 'owned-recovery')
    await mkdirActual(recoveryRoot, { mode: 0o700 })
    const sourcePath = join(directory, 'untitled.md')
    const owner = 'exact-coupled-editor-owner'
    const host = createUntitledPlaceholderRetentionHost({
      resolveRetentionRoot: async () => recoveryRoot
    })
    let cleanup = () => {}
    try {
      const token = await host.create(sourcePath, owner)
      store.setState({
        openFiles: store
          .getState()
          .openFiles.map((file) => ({ ...file, untitledPlaceholderLeaseToken: token }))
      })
      let released: Promise<void> | undefined
      disk.fs.releaseUntitledPlaceholder.mockImplementation(
        ({ leaseToken }: { leaseToken: string }) => {
          released = host.release(owner, leaseToken)
          return released
        }
      )
      disk.fs.discardUntitledPlaceholder.mockImplementation(
        ({ leaseToken }: { leaseToken: string }) => host.discard(sourcePath, owner, leaseToken)
      )
      let finishWrite!: () => Promise<void>
      disk.fs.writeFile.mockImplementationOnce(
        ({ filePath, content }: { filePath: string; content: string }) =>
          new Promise<void>((resolve, reject) => {
            finishWrite = async () => {
              try {
                await writeActual(sourcePath, content, 'utf8')
                disk.files.set(filePath, content)
                resolve()
              } catch (error) {
                reject(error)
                throw error
              }
            }
          })
      )
      loadFromDisk(store, '')
      cleanup = attachEditorAutosaveController(store)
      typeInto(store, 'real saved bytes after quiesce')
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.fs.writeFile).toHaveBeenCalledTimes(1)
      const discarded = discardEditorFileChangesAndClose(FILE_ID)
      await finishWrite()
      await discarded
      expect(released).toBeDefined()
      await released
      expect(await readActual(sourcePath, 'utf8')).toBe('real saved bytes after quiesce')
      expect(store.getState().openFiles).toHaveLength(0)
      expect(store.getState().editorDrafts[FILE_ID]).toBeUndefined()
      expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledTimes(1)
      expect(disk.fs.discardUntitledPlaceholder).not.toHaveBeenCalled()
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
      expect(await host.discard(sourcePath, owner, token)).toEqual({
        status: 'unavailable',
        reason: 'lease-unavailable'
      })
    } finally {
      cleanup()
      await host.releaseOwner(owner)
      await rmActual(directory, { recursive: true, force: true })
      await expect(readActual(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
