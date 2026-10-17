// Why: the E2EE auth handshake used to persist `lastSeenAt` inline, and on Windows every secure-file
// write blocked the main thread on synchronous icacls spawns (~1-1.5s cold each). The ACL now
// rides on the file's creation in-process; these tests pin how many secure writes land on the auth
// critical path, not wall-clock, so they are deterministic under load.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'

import { runProcess, runProcessSync } from '@orca/process-host'
import {
  resetWindowsSecurityLoadForTests,
  setWindowsSecurityForTests
} from '../../../shared/windows-security-addon'
import { createFakeWindowsSecurity } from '../../../shared/windows-security-addon.test-fixture'
import { DEVICE_REGISTRY_FILENAME } from '../mobile-pairing-files'
import { DeviceRegistry, type DeviceEntry } from '../device-registry'
import { generateKeyPair } from './e2ee-crypto'
import { RuntimeE2EEClientSession } from '../../../shared/runtime-e2ee-client-session'
import { MobileSocketWiring, type MobileSocketTransport } from './mobile-socket-wiring'

vi.mock('@orca/process-host', () => ({
  runProcess: vi.fn(),
  runProcessSync: vi.fn()
}))

/** One secure write is one born-restricted create: no verify-then-rewrite passes around it. */
const RESTRICTED_CREATES_PER_WRITE = 1

type TimelineEntry = 'restricted-create' | 'e2ee_ready' | 'e2ee_authenticated' | 'other-frame'

class FakeSocket {
  readonly OPEN = 1
  readyState = this.OPEN
  bufferedAmount = 0
  readonly sent: (string | Buffer)[] = []
  readonly close = vi.fn()
  send: (data: string | Buffer) => void = (data) => {
    this.sent.push(data)
  }
}

class FakeTransport implements MobileSocketTransport {
  private messageHandler: Parameters<MobileSocketTransport['onMessage']>[0] | null = null
  readonly setClientId = vi.fn()
  readonly terminateClientConnections = vi.fn(() => 0)

  onMessage(handler: Parameters<MobileSocketTransport['onMessage']>[0]): void {
    this.messageHandler = handler
  }

  onConnectionClose(): void {}

  receive(ws: FakeSocket, message: string): void {
    this.messageHandler?.(message, vi.fn(), ws as unknown as WebSocket)
  }
}

describe('mobile auth critical path', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const timeline: TimelineEntry[] = []
  let userDataPath = ''

  beforeEach(() => {
    timeline.length = 0
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-auth-acl-'))
    vi.mocked(runProcessSync).mockReset()
    vi.mocked(runProcess).mockReset()
    const fake = createFakeWindowsSecurity()
    const create = fake.createFileWithDacl
    fake.createFileWithDacl = (path, sddl, data) => {
      timeline.push('restricted-create')
      create(path, sddl, data)
    }
    setWindowsSecurityForTests(fake)
  })

  afterEach(() => {
    // The ACL work never starts a process, on or off the critical path.
    expect(runProcess).not.toHaveBeenCalled()
    expect(runProcessSync).not.toHaveBeenCalled()
    vi.useRealTimers()
    resetWindowsSecurityLoadForTests()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    rmSync(userDataPath, { recursive: true, force: true })
  })

  function authenticate(registry: DeviceRegistry, device: DeviceEntry): { ws: FakeSocket } {
    const desktop = generateKeyPair()
    const phone = RuntimeE2EEClientSession.create({
      desktopPublicKeyB64: Buffer.from(desktop.publicKey).toString('base64'),
      transport: 'direct'
    })
    const ws = new FakeSocket()
    ws.send = vi.fn((data: string | Buffer) => {
      ws.sent.push(data)
      const text = data.toString()
      if (text.startsWith('{')) {
        expect(phone.acceptReady(JSON.parse(text))).toBe(true)
      }
      const plaintext = text.startsWith('{') ? text : (phone.openText(text) ?? '')
      const type = (JSON.parse(plaintext || '{}') as { type?: string }).type
      if (type === 'e2ee_authenticated') {
        expect(phone.isAuthenticated(plaintext)).toBe(true)
      }
      timeline.push(type === 'e2ee_ready' || type === 'e2ee_authenticated' ? type : 'other-frame')
    })
    const transport = new FakeTransport()
    const wiring = new MobileSocketWiring({
      deviceRegistry: registry,
      e2eeKeypair: {
        publicKey: desktop.publicKey,
        secretKey: desktop.secretKey,
        publicKeyB64: Buffer.from(desktop.publicKey).toString('base64')
      },
      onText: vi.fn(),
      onBinary: vi.fn(),
      onClose: vi.fn()
    })
    wiring.attachTransport(transport)
    transport.receive(ws, JSON.stringify(phone.hello))
    transport.receive(ws, phone.sealText(phone.authMessage(device.token)))
    return { ws }
  }

  function readPersistedDevices(): DeviceEntry[] {
    return JSON.parse(
      readFileSync(join(userDataPath, DEVICE_REGISTRY_FILENAME), 'utf-8')
    ) as DeviceEntry[]
  }

  it('emits e2ee_authenticated without a single secure write on the critical path', () => {
    const registry = new DeviceRegistry(userDataPath)
    const device = registry.addDevice('Phone', 'runtime')
    // Why: a re-connecting device is the measured case; the first sighting is covered below.
    registry.updateLastSeen(device.deviceId)
    timeline.length = 0

    authenticate(registry, device)

    expect(timeline).toEqual(['e2ee_ready', 'e2ee_authenticated'])

    registry.flushPendingLastSeen()
    // The write is deferred, never dropped, and still born restricted.
    expect(timeline.filter((entry) => entry === 'restricted-create')).toHaveLength(
      RESTRICTED_CREATES_PER_WRITE
    )
    expect(readPersistedDevices()[0]?.lastSeenAt).toBe(
      registry.getDevice(device.deviceId)?.lastSeenAt
    )
  })

  it('still persists the first sighting before authenticating', () => {
    const registry = new DeviceRegistry(userDataPath)
    const device = registry.addDevice('Phone', 'runtime')
    timeline.length = 0

    authenticate(registry, device)

    // Why: rotatePendingDevice drops entries disk says were never scanned, so this write stays inline.
    expect(timeline).toEqual([
      'e2ee_ready',
      ...Array<TimelineEntry>(RESTRICTED_CREATES_PER_WRITE).fill('restricted-create'),
      'e2ee_authenticated'
    ])
    expect(readPersistedDevices()[0]?.lastSeenAt).toBeGreaterThan(0)
  })

  it('coalesces a reconnect burst into one deferred write', () => {
    vi.useFakeTimers()
    const registry = new DeviceRegistry(userDataPath)
    const device = registry.addDevice('Phone', 'runtime')
    registry.updateLastSeen(device.deviceId)
    timeline.length = 0

    for (let attempt = 0; attempt < 5; attempt += 1) {
      authenticate(registry, device)
    }

    expect(timeline.filter((entry) => entry === 'restricted-create')).toHaveLength(0)
    vi.advanceTimersByTime(250)
    expect(timeline.filter((entry) => entry === 'restricted-create')).toHaveLength(
      RESTRICTED_CREATES_PER_WRITE
    )
  })

  it('cancels the deferred rewrite when another registry save persists the timestamp', () => {
    vi.useFakeTimers()
    const registry = new DeviceRegistry(userDataPath)
    const device = registry.addDevice('Phone', 'runtime')
    registry.updateLastSeen(device.deviceId)
    timeline.length = 0

    registry.updateLastSeenDeferred(device.deviceId)
    registry.addDevice('Other client', 'runtime')
    expect(timeline.filter((entry) => entry === 'restricted-create')).toHaveLength(
      RESTRICTED_CREATES_PER_WRITE
    )

    vi.advanceTimersByTime(250)
    expect(timeline.filter((entry) => entry === 'restricted-create')).toHaveLength(
      RESTRICTED_CREATES_PER_WRITE
    )
  })
})
