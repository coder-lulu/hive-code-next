import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Hive Runtime Cloud Presence wiring', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

  it('shares one account refresh between desktop IPC and headless Presence', () => {
    const proxyIndex = source.indexOf('await applyElectronProxySettings(')
    const accountIndex = source.indexOf('const processHiveAccountService = new HiveAccountService(')
    const refreshIndex = source.indexOf('.refresh()', accountIndex)
    const runtimeIndex = source.indexOf('const runtimeService = new OrcaRuntimeService(')
    const presenceIndex = source.indexOf(
      'const processRuntimeCloudPresence = new HiveRuntimeCloudPresenceService(',
      runtimeIndex
    )

    expect(proxyIndex).toBeGreaterThanOrEqual(0)
    expect(accountIndex).toBeGreaterThan(proxyIndex)
    expect(refreshIndex).toBeGreaterThan(accountIndex)
    expect(runtimeIndex).toBeGreaterThan(refreshIndex)
    expect(presenceIndex).toBeGreaterThan(runtimeIndex)
    expect(source).toContain('hiveAccountService.subscribeRuntimeCloudAuthorization(')
    expect(source).toContain('hiveAccountService.getRuntimeCloudAuthorization()')
    expect(source).toContain('...(hiveAccountService ? { hiveAccountService } : {})')
    expect(source).toContain('...(hiveAccountStartupState ? { hiveAccountStartupState } : {})')
  })

  it('does not publish readiness until the local Runtime RPC transport starts', () => {
    const serveIndex = source.indexOf('if (serveOptions) {')
    const headlessStart = source.indexOf('await runtimeRpc.start()', serveIndex)
    const headlessReady = source.indexOf(
      'runtimeCloudPresence?.setRuntimeReady(true)',
      headlessStart
    )
    const desktopStart = source.indexOf('desktopRuntimeRpc.start()', headlessReady)
    const desktopFailure = source.indexOf('if (!runtimeRpcStartResult.ok)', desktopStart)
    const desktopReady = source.indexOf(
      'runtimeCloudPresence?.setRuntimeReady(true)',
      desktopFailure
    )

    expect(headlessStart).toBeGreaterThan(serveIndex)
    expect(headlessReady).toBeGreaterThan(headlessStart)
    expect(desktopStart).toBeGreaterThan(headlessReady)
    expect(desktopFailure).toBeGreaterThan(desktopStart)
    expect(desktopReady).toBeGreaterThan(desktopFailure)
  })

  it('fences synchronously before quit and joins Presence shutdown to the quit barrier', () => {
    const relaunch = source.indexOf('onBeforeRelaunch: async () => {')
    const relaunchReadyFence = source.indexOf(
      'runtimeCloudPresence?.setRuntimeReady(false)',
      relaunch
    )
    const relaunchAuthFence = source.indexOf(
      'runtimeCloudPresence?.setAuthorization(null)',
      relaunchReadyFence
    )
    const updateQuit = source.indexOf('onBeforeUpdateQuit: () => {')
    const updateReadyFence = source.indexOf(
      'runtimeCloudPresence?.setRuntimeReady(false)',
      updateQuit
    )
    const updateAuthFence = source.indexOf(
      'runtimeCloudPresence?.setAuthorization(null)',
      updateReadyFence
    )
    const beforeQuit = source.indexOf("app.on('before-quit'")
    const readyFence = source.indexOf('runtimeCloudPresence?.setRuntimeReady(false)', beforeQuit)
    const authFence = source.indexOf('runtimeCloudPresence?.setAuthorization(null)', readyFence)
    const willQuit = source.indexOf("app.on('will-quit'", authFence)
    const stop = source.indexOf('runtimeCloudPresence?.stop()', willQuit)
    const barrier = source.indexOf("{ name: 'runtime-cloud-presence'", stop)

    expect(relaunchReadyFence).toBeGreaterThan(relaunch)
    expect(relaunchAuthFence).toBeGreaterThan(relaunchReadyFence)
    expect(updateReadyFence).toBeGreaterThan(updateQuit)
    expect(updateAuthFence).toBeGreaterThan(updateReadyFence)
    expect(beforeQuit).toBeGreaterThanOrEqual(0)
    expect(readyFence).toBeGreaterThan(beforeQuit)
    expect(authFence).toBeGreaterThan(readyFence)
    expect(willQuit).toBeGreaterThan(authFence)
    expect(stop).toBeGreaterThan(willQuit)
    expect(barrier).toBeGreaterThan(stop)
  })
})
