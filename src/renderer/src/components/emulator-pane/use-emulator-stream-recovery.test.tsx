// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEmulatorStreamRecovery } from './use-emulator-stream-recovery'

let container: HTMLDivElement
let root: Root
let recovery: ReturnType<typeof useEmulatorStreamRecovery> | null

function Probe({ onReconnect }: { onReconnect: () => Promise<void> }): React.JSX.Element | null {
  recovery = useEmulatorStreamRecovery(onReconnect)
  return null
}

async function requestAutomaticRecovery(): Promise<void> {
  await act(async () => {
    recovery?.requestAutomaticRecovery()
    await Promise.resolve()
  })
}

describe('useEmulatorStreamRecovery', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    recovery = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('caps automatic reconnects until a decoded frame proves recovery', async () => {
    const onReconnect = vi.fn(async () => {})
    await act(async () => root.render(<Probe onReconnect={onReconnect} />))

    await requestAutomaticRecovery()
    await requestAutomaticRecovery()
    await requestAutomaticRecovery()
    expect(onReconnect).toHaveBeenCalledTimes(2)

    act(() => recovery?.markRecovered())
    await requestAutomaticRecovery()
    expect(onReconnect).toHaveBeenCalledTimes(3)
  })

  it('allows an explicit retry after the automatic budget is exhausted', async () => {
    const onReconnect = vi.fn(async () => {})
    await act(async () => root.render(<Probe onReconnect={onReconnect} />))

    await requestAutomaticRecovery()
    await requestAutomaticRecovery()
    await requestAutomaticRecovery()
    await act(async () => {
      recovery?.requestManualRecovery()
      await Promise.resolve()
    })

    expect(onReconnect).toHaveBeenCalledTimes(3)
  })
})
