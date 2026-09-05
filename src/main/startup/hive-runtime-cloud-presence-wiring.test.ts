import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(join(import.meta.dirname, name), 'utf8').replaceAll('\r\n', '\n')
const cloud = read('main-process-hive-runtime-cloud.ts')
const foundation = read('main-process-ready-foundation.ts')
const ready = read('main-process-ready-runtime.ts')
const launch = read('main-process-runtime-launch.ts')
const core = read('main-window-core-services.ts')
const quit = read('main-process-quit.ts')

describe('Hive Runtime Cloud Presence wiring', () => {
  it('shares one account refresh after the proxy barrier with desktop IPC and headless Presence', () => {
    expect(foundation.indexOf('state.initialProxyApplicationReady =')).toBeGreaterThanOrEqual(0)
    expect(foundation.indexOf('initializeHiveAccount()')).toBeGreaterThan(
      foundation.indexOf('state.initialProxyApplicationReady =')
    )
    expect(cloud).toMatch(
      /state\.hiveAccountStartupState = state\.initialProxyApplicationReady\s*\.then/
    )
    expect(cloud.match(/new HiveAccountService\(/g)).toHaveLength(1)
    expect(cloud.match(/account\.refresh\(/g)).toHaveLength(1)
    expect(ready.indexOf('initializeHiveRuntimeCloud(runtime)')).toBeGreaterThan(
      ready.indexOf('const runtime = initializeMainProcessRuntime()')
    )
    expect(cloud).toContain('hiveAccountService.subscribeRuntimeCloudAuthorization(')
    expect(cloud).toContain('hiveAccountService.getRuntimeCloudAuthorization()')
    expect(core).toContain('hiveAccountService: state.hiveAccountService')
    expect(core).toContain('hiveAccountStartupState: state.hiveAccountStartupState')
  })

  it('publishes readiness only after the local RPC starts, excluding desktop failure', () => {
    const serve = launch.slice(
      launch.indexOf('async function launchServeMode('),
      launch.indexOf('async function launchDesktopMode(')
    )
    const desktop = launch.slice(
      launch.indexOf('async function launchDesktopMode('),
      launch.indexOf('export async function initializeMainProcessRuntimeLaunch(')
    )
    expect(serve.indexOf('await runtimeRpc.start()')).toBeGreaterThanOrEqual(0)
    expect(serve.indexOf('state.runtimeCloudPresence?.setRuntimeReady(true)')).toBeGreaterThan(
      serve.indexOf('await runtimeRpc.start()')
    )
    expect(desktop).toMatch(
      /if \(runtimeRpcStartResult\.ok\) \{\s*state\.runtimeCloudPresence\?\.setRuntimeReady\(true\)/
    )
    expect(desktop.indexOf('if (runtimeRpcStartResult.ok)')).toBeGreaterThan(
      desktop.indexOf('await Promise.all([')
    )
  })

  it('fences relaunch, update and quit synchronously and joins cloud shutdown to the committed barrier', () => {
    for (const anchor of ['onBeforeRelaunch: async () => {', 'onBeforeUpdateQuit: () => {']) {
      const start = core.indexOf(anchor)
      const end = core.indexOf('preserveAgentAuthBeforeRestart(', start)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(start)
      expect(core.slice(start, end)).toContain('state.runtimeCloudPresence?.setRuntimeReady(false)')
      expect(core.slice(start, end)).toContain('state.runtimeCloudPresence?.setAuthorization(null)')
    }
    const beforeQuit = quit.slice(
      quit.indexOf("app.on('before-quit'"),
      quit.indexOf("app.on('will-quit'")
    )
    expect(beforeQuit).toContain('state.runtimeCloudPresence?.setRuntimeReady(false)')
    expect(beforeQuit).toContain('state.runtimeCloudPresence?.setAuthorization(null)')
    expect(quit.indexOf('const runtimeCloudShutdown = stopHiveRuntimeCloud()')).toBeGreaterThan(
      quit.indexOf('quitTeardownStartGate.tryStart(event)')
    )
    expect(quit).toMatch(/settleTeardownWithinDeadline\(\[\s*\.\.\.runtimeCloudShutdown,/)
    expect(cloud).toContain('state.runtimeCloudPresence?.stop()')
    expect(cloud).toContain(
      "{ name: 'runtime-cloud-presence', promise: runtimeCloudPresenceShutdown }"
    )
    expect(cloud).toContain(
      "{ name: 'runtime-cloud-web-session-control', promise: runtimeCloudWebSessionControlShutdown }"
    )
  })
})
