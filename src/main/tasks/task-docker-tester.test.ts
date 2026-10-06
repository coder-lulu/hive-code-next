import { mkdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { taskDockerConfiguration } from './task-docker-configuration'
import { taskDockerBinding, taskDockerIdentityMatchesRecord } from './task-docker-identity'
import { dockerArgs, taskDockerFixture } from './task-docker-boundary.test-fixture'
import { testerDockerFixture, testerWorkflowContext } from './task-docker-tester.test-fixture'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'
import { TaskExecutionRecordSchema } from './task-execution-record'
import { admitTaskExecution } from './task-execution-admission'
import { emptyState } from '../runtime/agent-session-store-parsing'

describe('fixed independent tester Docker mounts', () => {
  it('derives code RO and independent outputs RW only from authenticated command role metadata', async () => {
    const h = await testerDockerFixture()
    const config = h.configuration()
    const mounts = config.createArgs.flatMap((arg, index) =>
      arg === '--mount' ? [config.createArgs[index + 1]] : []
    )
    expect(mounts).toHaveLength(2)
    expect(mounts).toContain(
      `type=bind,source=${h.record.workspace.executionPath},target=/workspace,readonly,bind-propagation=rprivate`
    )
    expect(mounts).toContain(
      `type=bind,source=${h.output.outputDirectory.path},target=/outputs,bind-propagation=rprivate`
    )
    await h.boundary().prepare()
    expect(h.container().Mounts.find((mount) => mount.Destination === '/workspace')?.RW).toBe(false)
    expect(h.container().Mounts.find((mount) => mount.Destination === '/outputs')?.RW).toBe(true)
  })

  it('rejects missing tester output evidence, output on another role, and caller readonly metadata', async () => {
    const h = await testerDockerFixture()
    const { outputDirectory, ...workspace } = h.record.workspace
    expect(outputDirectory).toBeDefined()
    expect(() =>
      taskDockerConfiguration({ ...h.options, record: { ...h.record, workspace } })
    ).toThrow()
    const context = testerWorkflowContext()
    context.role = 'developer'
    expect(() =>
      taskDockerConfiguration({
        ...h.options,
        record: { ...h.record, command: { ...h.record.command, workflowContext: context } }
      })
    ).toThrow()
    const forgedContext = { ...context, readonly: true }
    expect(() =>
      taskDockerConfiguration({
        ...h.options,
        record: {
          ...h.record,
          command: { ...h.record.command, workflowContext: forgedContext }
        }
      })
    ).toThrow()
    const normal = await taskDockerFixture(
      resolve('logs/paperclip-development/p3/role-handoffs/docker-tester/tmp')
    )
    const normalConfig = taskDockerConfiguration(normal.options)
    expect(normalConfig.createArgs.filter((arg) => arg === '--mount')).toHaveLength(1)
    expect(normalConfig.createArgs.some((arg) => arg.includes('readonly'))).toBe(false)
  })

  it.each([
    'code_rw',
    'host_code_rw',
    'outputs_ro',
    'host_outputs_ro',
    'source',
    'target',
    'extra'
  ])('rejects exact mount tampering: %s', async (tamper) => {
    const h = await testerDockerFixture()
    const boundary = h.boundary()
    await boundary.prepare()
    const container = h.container()
    const code = container.Mounts.find((mount) => mount.Destination === '/workspace')
    const outputs = container.Mounts.find((mount) => mount.Destination === '/outputs')
    const hostCode = container.HostConfig.Mounts.find((mount) => mount.Target === '/workspace')
    const hostOutputs = container.HostConfig.Mounts.find((mount) => mount.Target === '/outputs')
    if (!code || !outputs || !hostCode || !hostOutputs) {
      throw new Error('Missing tester mounts')
    }
    if (tamper === 'code_rw') {
      code.RW = true
    }
    if (tamper === 'host_code_rw') {
      Object.assign(hostCode, { ReadOnly: false })
    }
    if (tamper === 'outputs_ro') {
      outputs.RW = false
    }
    if (tamper === 'host_outputs_ro') {
      Object.assign(hostOutputs, { ReadOnly: true })
    }
    if (tamper === 'source') {
      outputs.Source = h.record.workspace.executionPath
    }
    if (tamper === 'target') {
      outputs.Destination = '/workspace'
    }
    if (tamper === 'extra') {
      container.Mounts.push({ ...outputs, Destination: '/extra' })
    }
    expect(await boundary.inspect()).toBe('unverifiable')
    await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
  })

  it('binds the output identity into durable ownership labels and rejects replacement before launch', async () => {
    const h = await testerDockerFixture()
    const boundary = h.boundary()
    await boundary.prepare()
    const captured = h.options.persistIdentity.mock.calls.at(-1)?.[0]
    if (!captured) {
      throw new Error('Missing captured identity')
    }
    expect(taskDockerIdentityMatchesRecord(captured, h.record)).toBe(true)
    const changed = {
      ...h.record,
      workspace: {
        ...h.record.workspace,
        outputDirectory: {
          ...h.output.outputDirectory,
          directoryIdentity: { ...h.output.outputDirectory.directoryIdentity, ino: '999' }
        }
      }
    }
    expect(taskDockerBinding(changed).labels).not.toEqual(captured.labels)
    expect(taskDockerIdentityMatchesRecord(captured, changed)).toBe(false)
    await rename(h.output.outputDirectory.path, `${h.output.outputDirectory.path}-original`)
    await mkdir(h.output.outputDirectory.path)
    await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
  })

  it('proves original container termination even after code and output directories disappear', async () => {
    const h = await testerDockerFixture()
    const boundary = h.boundary()
    await boundary.prepare()
    h.start()
    const identity = h.options.persistIdentity.mock.calls.at(-1)?.[0]
    if (!identity) {
      throw new Error('Missing original identity')
    }
    await rm(h.record.workspace.executionPath, { recursive: true })
    await rm(h.output.outputDirectory.path, { recursive: true })
    const recovered = createTaskDockerBoundary({
      ...h.options,
      persistIdentity: undefined,
      recoveryIdentity: identity
    })
    expect(await recovered.stop()).toBe(true)
    expect(h.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'kill')).toHaveLength(1)
  })

  it('requires tester output and forbids outputs for non-testers in the durable record schema', async () => {
    const h = await testerDockerFixture()
    const context = testerWorkflowContext()
    const command = taskCommand({
      task: {
        ...taskCommand().task,
        spaceId: context.binding.scope.companyRef,
        taskId: 'task:independent',
        runId: 'run:independent'
      },
      executionId: 'execution:independent',
      executionDeadlineAt: new Date(TASK_TEST_NOW + 60_000).toISOString(),
      workspaceExecutionClaimRef: 'claim:independent',
      workflowContext: context,
      executionPolicy: {
        trustMode: 'enforced_autonomous',
        executionPolicyRef: 'docker-local-linux',
        executionPolicyRevision: '1',
        enforcementEvidenceRef: 'evidence:host'
      }
    })
    const record = admitTaskExecution(emptyState('local'), {
      command,
      workspace: h.record.workspace,
      operationCallerKey: 'caller:owned',
      now: TASK_TEST_NOW,
      validate: () => undefined
    }).record
    expect(TaskExecutionRecordSchema.safeParse(record).success).toBe(true)
    const { outputDirectory, ...workspace } = h.record.workspace
    expect(outputDirectory).toBeDefined()
    expect(TaskExecutionRecordSchema.safeParse({ ...record, workspace }).success).toBe(false)
    const normal = admitTaskExecution(emptyState('local'), {
      command: taskCommand(),
      workspace,
      operationCallerKey: 'caller:owned',
      now: TASK_TEST_NOW,
      validate: () => undefined
    }).record
    expect(
      TaskExecutionRecordSchema.safeParse({ ...normal, workspace: h.record.workspace }).success
    ).toBe(false)
    expect(join(h.output.outputDirectory.path, 'report.md')).not.toContain(
      `${h.record.workspace.executionPath}/`
    )
  })
})
