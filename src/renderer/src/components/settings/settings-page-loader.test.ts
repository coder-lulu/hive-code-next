import { describe, expect, it, vi } from 'vitest'
import { createRetryableModuleLoader } from './settings-page-loader'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('settings page module loader', () => {
  it('shares one in-flight import between concurrent preload and navigation calls', async () => {
    const module = { default: () => null }
    const importRequest = deferred<typeof module>()
    const importModule = vi.fn(() => importRequest.promise)
    const loadModule = createRetryableModuleLoader(importModule)

    const preload = loadModule()
    const navigation = loadModule()

    expect(navigation).toBe(preload)
    expect(importModule).toHaveBeenCalledOnce()

    importRequest.resolve(module)
    await expect(Promise.all([preload, navigation])).resolves.toEqual([module, module])
  })

  it('clears a rejected import so a later navigation can retry', async () => {
    const failure = new Error('chunk unavailable')
    const module = { default: () => null }
    const importModule = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(module)
    const loadModule = createRetryableModuleLoader(importModule)

    await expect(loadModule()).rejects.toBe(failure)
    await expect(loadModule()).resolves.toBe(module)
    expect(importModule).toHaveBeenCalledTimes(2)
  })

  it('does not retain a synchronous loader failure', async () => {
    const module = { default: () => null }
    const importModule = vi
      .fn<() => Promise<typeof module>>()
      .mockImplementationOnce(() => {
        throw new Error('loader setup failed')
      })
      .mockResolvedValueOnce(module)
    const loadModule = createRetryableModuleLoader(importModule)

    await expect(loadModule()).rejects.toThrow('loader setup failed')
    await expect(loadModule()).resolves.toBe(module)
  })
})
