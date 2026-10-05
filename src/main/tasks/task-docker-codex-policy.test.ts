import { describe, expect, it } from 'vitest'
import { guardTaskDockerCodexFrame } from './task-docker-codex-policy'

const external = { type: 'externalSandbox', networkAccess: 'restricted' }
const request = (method: string, params: Record<string, unknown> = {}) => ({
  id: 1,
  method,
  params
})

describe('task Docker Codex policy', () => {
  it('pins every new and resumed thread to the container workspace and never approvals', () => {
    for (const method of ['thread/start', 'thread/resume']) {
      const params =
        method === 'thread/resume' ? { threadId: 'original-thread' } : { model: 'selected-model' }
      expect(guardTaskDockerCodexFrame(request(method, params))).toEqual(
        request(method, {
          ...params,
          cwd: '/workspace',
          modelProvider: 'hive-loopback',
          sandbox: 'workspace-write',
          approvalPolicy: 'never'
        })
      )
    }
  })

  it('pins the local broker provider and rejects native/provider substitutions', () => {
    expect(() =>
      guardTaskDockerCodexFrame(request('thread/start', { modelProvider: 'hive-loopback' }))
    ).not.toThrow()
    for (const modelProvider of ['openai', 'remote', '']) {
      expect(() => guardTaskDockerCodexFrame(request('thread/start', { modelProvider }))).toThrow(
        'TASK_DOCKER_POLICY_REFUSED'
      )
    }
  })

  it('pins commands and every turn to the real external container boundary', () => {
    for (const method of ['command/exec', 'turn/start']) {
      const params =
        method === 'command/exec'
          ? { command: ['/bin/sh', '-c', 'printf ok'] }
          : { threadId: 'original-thread', input: [{ type: 'text', text: 'requirement' }] }
      const guarded = guardTaskDockerCodexFrame(request(method, params))
      expect(guarded).toEqual(
        request(method, {
          ...params,
          cwd: '/workspace',
          sandboxPolicy: external,
          ...(method === 'turn/start'
            ? { approvalPolicy: 'never' }
            : { timeoutMs: 30_000, outputBytesCap: 1024 * 1024 })
        })
      )
      expect(guardTaskDockerCodexFrame(guarded)).toEqual(guarded)
    }
  })

  it.each(['thread/start', 'thread/resume', 'turn/start', 'command/exec'])(
    'rejects widening %s permissions and directories',
    (method) => {
      for (const change of [
        { cwd: '/' },
        { cwd: '/workspace/../home/hive' },
        { cwd: '/workspace/subdir' },
        { approvalPolicy: 'on-request' },
        { sandbox: 'danger-full-access' },
        { sandboxPolicy: { type: 'dangerFullAccess' } },
        { sandboxPolicy: { ...external, networkAccess: 'enabled' } },
        { sandboxPolicy: { ...external, writableRoots: ['/'] } },
        { config: {} },
        { config: { sandbox_mode: 'danger-full-access' } },
        { env: { TOKEN: 'injected' } },
        { permissionProfile: 'full-access' }
      ]) {
        expect(() => guardTaskDockerCodexFrame(request(method, change))).toThrow(
          'TASK_DOCKER_POLICY_REFUSED'
        )
      }
    }
  )

  it.each([
    'config/write',
    'config/batchWrite',
    'account/login/start',
    'account/login/cancel',
    'account/logout',
    'mcpServer/reload',
    'mcpServer/oauth/login',
    'plugin/install',
    'thread/fork',
    'thread/backgroundTerminals/clean',
    'skills/config/write',
    'unknown/method'
  ])('refuses unsupported mutating method %s', (method) => {
    expect(() => guardTaskDockerCodexFrame(request(method))).toThrow('TASK_DOCKER_POLICY_REFUSED')
  })

  it('refuses unbounded commands and disallows environment injection', () => {
    for (const params of [
      { command: [] },
      { command: ['node', '\0'] },
      { command: ['node', 'x'.repeat(128 * 1024)] },
      { command: ['node'], disableTimeout: true },
      { command: ['node'], disableOutputCap: true },
      { command: ['node'], timeoutMs: 30_001 },
      { command: ['node'], outputBytesCap: 1024 * 1024 + 1 },
      { command: ['node'], env: null },
      { command: ['node'], permissionProfile: 'unrestricted' }
    ]) {
      expect(() => guardTaskDockerCodexFrame(request('command/exec', params))).toThrow(
        'TASK_DOCKER_POLICY_REFUSED'
      )
    }
  })

  it('refuses resume paths outside the single container account home', () => {
    for (const path of [
      '/host/private/session',
      '/home/hive/.codex/sessions/../../auth.json',
      'C:\\Users\\owner\\.codex\\auth.json'
    ]) {
      expect(() =>
        guardTaskDockerCodexFrame(request('thread/resume', { threadId: 'original', path }))
      ).toThrow('TASK_DOCKER_POLICY_REFUSED')
    }
    expect(
      guardTaskDockerCodexFrame(
        request('thread/resume', {
          threadId: 'original',
          path: '/home/hive/.codex/sessions/2026/10/05/original.jsonl'
        })
      )
    ).toMatchObject({ params: { threadId: 'original' } })
  })

  it('preserves supported history, catalog, config and cancellation reads', () => {
    for (const method of [
      'initialize',
      'initialized',
      'model/list',
      'config/read',
      'configRequirements/read',
      'thread/read',
      'thread/turns/list',
      'thread/unsubscribe',
      'turn/interrupt'
    ]) {
      const frame = request(method, { threadId: 'original-thread' })
      expect(guardTaskDockerCodexFrame(frame)).toEqual(frame)
    }
  })

  it('forwards bounded server answers but refuses malformed envelopes', () => {
    expect(
      guardTaskDockerCodexFrame({ id: 'approval-1', result: { decision: 'decline' } })
    ).toEqual({ id: 'approval-1', result: { decision: 'decline' } })
    for (const frame of [
      null,
      [],
      'initialize',
      { method: 'initialized', extra: true },
      { id: 1, result: {}, error: {} },
      { id: {}, result: {} }
    ]) {
      expect(() => guardTaskDockerCodexFrame(frame)).toThrow('TASK_DOCKER_POLICY_REFUSED')
    }
  })
})
