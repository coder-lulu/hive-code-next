import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { DeviceRegistry } from './device-registry'
import { createMobileRpcSurfaceRuntime } from './runtime-rpc-mobile-method-allowlist-fixtures'

describe('Hive mobile project access', () => {
  it('requires a paired mobile token for repo.add and reports unavailable push tests', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'hive-mobile-project-auth-'))
    try {
      const { runtime } = createMobileRpcSurfaceRuntime()
      const notifications = new RuntimeMobileNotificationController()
      runtime.testMobileNotificationRemotePush = () => notifications.testRemotePush()
      runtime.addRepo = vi.fn().mockResolvedValue({ id: 'repo-1', path: '/repo', kind: 'git' })
      const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
      server['deviceRegistry'] = new DeviceRegistry(userDataPath)
      const mobile = server['deviceRegistry']!.addDevice('phone', 'mobile')
      const dispatch = async (method: string, deviceToken: string, params: unknown) => {
        const replies: unknown[] = []
        await server['handleWebSocketMessage'](
          JSON.stringify({ id: method, method, deviceToken, params }),
          (reply) => replies.push(JSON.parse(reply)),
          () => {}
        )
        return replies[0]
      }
      expect(
        await dispatch('repo.add', 'invalid-token', { path: '/repo', kind: 'git' })
      ).toMatchObject({ ok: false })
      expect(runtime.addRepo).not.toHaveBeenCalled()
      expect(
        await dispatch('repo.add', mobile.token, { path: '/repo', kind: 'git' })
      ).toMatchObject({ ok: true, result: { repo: { id: 'repo-1' } } })
      expect(runtime.addRepo).toHaveBeenCalledExactlyOnceWith('/repo', 'git', undefined, undefined)
      expect(await dispatch('notifications.testPush', mobile.token, {})).toMatchObject({
        ok: true,
        result: { accepted: false, reason: 'unavailable' }
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
import { RuntimeMobileNotificationController } from './runtime-mobile-notification-controller'
