import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AndroidManagedAvdProcesses,
  type AndroidAvdProcessSpawner,
  type AndroidAvdProcessTerminator
} from './android-managed-avd-processes'

function fakeChild(pid: number): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    unref: vi.fn(),
    kill: vi.fn(() => true)
  }) as unknown as ChildProcess
}

describe('AndroidManagedAvdProcesses', () => {
  let children: ChildProcess[]
  let spawn: ReturnType<typeof vi.fn>
  let terminateTree: ReturnType<typeof vi.fn>
  let managed: AndroidManagedAvdProcesses

  beforeEach(() => {
    children = []
    spawn = vi.fn(() => {
      const child = fakeChild(7_000 + children.length)
      children.push(child)
      return child
    })
    terminateTree = vi.fn(async () => true)
    managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      terminateTree as unknown as AndroidAvdProcessTerminator
    )
  })

  it('keeps one managed identity per AVD and maps its discovered serial', () => {
    const launched = managed.launch('/sdk/emulator', 'Pixel_7')
    managed.bindSerial(launched, 'emulator-5554')

    expect(managed.launch('/sdk/emulator', 'Pixel_7')).toBe(launched)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith({
      program: '/sdk/emulator',
      args: ['-avd', 'Pixel_7', '-no-window'],
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    expect(managed.findByName('Pixel_7')).toBe(launched)
    expect(managed.findBySerial('emulator-5554')).toBe(launched)
    expect(managed.namesBySerial()).toEqual(new Map([['emulator-5554', 'Pixel_7']]))
  })

  it('launches a managed recovery without loading the stale snapshot', () => {
    managed.launch('/sdk/emulator', 'Pixel_7', { coldBoot: true })

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['-avd', 'Pixel_7', '-no-snapshot-load', '-no-window']
      })
    )
  })

  it('records an early child exit and keeps bounded diagnostic output', async () => {
    const launched = managed.launch('/sdk/emulator', 'Pixel_7')
    const child = children[0]
    child.stderr?.emit('data', Buffer.alloc(20 * 1024, 'x'))
    child.stderr?.emit('data', 'AVD lock is already held')
    child.emit('exit', 1, null)

    await expect(launched.exit).resolves.toEqual({ code: 1, signal: null })
    expect(launched.exitResult).toEqual({ code: 1, signal: null })
    expect(launched.output().length).toBeLessThanOrEqual(16 * 1024)
    expect(launched.output()).toContain('AVD lock is already held')
    expect(managed.findByName('Pixel_7')).toBeNull()
  })

  it('terminates only records it owns and disposes every remaining managed process', async () => {
    const first = managed.launch('/sdk/emulator', 'Pixel_7')
    const second = managed.launch('/sdk/emulator', 'Pixel_Tablet')

    await managed.terminate(first)
    await managed.dispose()

    expect(terminateTree).toHaveBeenCalledTimes(2)
    expect(terminateTree).toHaveBeenNthCalledWith(1, first.child)
    expect(terminateTree).toHaveBeenNthCalledWith(2, second.child)
    expect(managed.findByName('Pixel_7')).toBeNull()
    expect(managed.findByName('Pixel_Tablet')).toBeNull()
  })

  it('retains ownership when process-tree termination cannot be verified', async () => {
    terminateTree.mockResolvedValue(false)
    const launched = managed.launch('/sdk/emulator', 'Pixel_7')

    await expect(managed.terminate(launched)).resolves.toBe(false)

    expect(managed.findByName('Pixel_7')).toBe(launched)
  })
})
