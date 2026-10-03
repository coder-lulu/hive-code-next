import { describe, expect, it, vi } from 'vitest'
import { RuntimeTerminalDriverController } from './runtime-terminal-driver-controller'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  const barriers = new Map<string, ReturnType<typeof deferred>>()
  const commit = vi.fn(
    async (pty: string, client: string, _previous: unknown, isCurrent: () => boolean) => {
      await barriers.get(client)?.promise
      if (isCurrent()) {
        controller.set(pty, { kind: 'mobile', clientId: client })
      }
    }
  )
  const controller = new RuntimeTerminalDriverController({
    notifyChanged: vi.fn(),
    canClaimMobileFloor: () => true,
    commitMobileFloor: commit
  })
  return { controller, barriers, commit }
}

describe('mobile input floor claims', () => {
  it.each(['desktop', 'idle', 'clear'] as const)(
    'invalidates a delayed claim after %s takeback',
    async (takeback) => {
      const { controller, barriers } = fixture()
      const barrier = deferred()
      barriers.set('phone', barrier)
      const claim = controller.beginMobileInputFloor('pty', 'phone')!
      const pending = claim.commit()
      if (takeback === 'clear') {
        controller.clear('pty')
      } else {
        controller.set('pty', { kind: takeback })
      }
      barrier.resolve()
      await pending
      expect(controller.get('pty')).toEqual({ kind: takeback === 'desktop' ? 'desktop' : 'idle' })
    }
  )
  it('does not start display work for an invalidated claim', async () => {
    const { controller, commit } = fixture()
    const claim = controller.beginMobileInputFloor('pty', 'phone')!
    controller.set('pty', { kind: 'desktop' })
    await claim.commit()
    expect(commit).not.toHaveBeenCalled()
  })
  it('keeps the newer in-flight claim fenced when an older one finishes', async () => {
    const { controller, barriers } = fixture()
    const first = deferred(),
      second = deferred()
    barriers.set('first', first)
    barriers.set('second', second)
    const earlier = controller.beginMobileInputFloor('pty', 'first')!.commit()
    const later = controller.beginMobileInputFloor('pty', 'second')!.commit()
    first.resolve()
    await earlier
    controller.set('pty', { kind: 'mobile', clientId: 'observer' })
    second.resolve()
    await later
    expect(controller.get('pty')).toEqual({ kind: 'mobile', clientId: 'second' })
  })
  it('keeps the latest same-phone claim and rejects an older phone completion', async () => {
    const { controller, barriers } = fixture()
    const first = deferred()
    barriers.set('first', first)
    const earlier = controller.beginMobileInputFloor('pty', 'first')!.commit()
    await controller.beginMobileInputFloor('pty', 'second')!.commit()
    await controller.beginMobileInputFloor('pty', 'second')!.commit()
    first.resolve()
    await earlier
    expect(controller.get('pty')).toEqual({ kind: 'mobile', clientId: 'second' })
  })
  it('releases a failed display commit so a new claim can settle', async () => {
    const { controller, commit } = fixture()
    commit.mockRejectedValueOnce(new Error('display unavailable'))
    await expect(controller.beginMobileInputFloor('pty', 'first')!.commit()).rejects.toThrow(
      'display unavailable'
    )
    controller.set('pty', { kind: 'desktop' })
    const claim = controller.beginMobileInputFloor('pty', 'second')!
    claim.rollback()
    expect(controller.get('pty')).toEqual({ kind: 'desktop' })
  })
})
