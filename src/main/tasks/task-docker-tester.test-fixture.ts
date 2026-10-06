import { vi } from 'vitest'
import { resolve } from 'node:path'
import { WorkflowExecutionContextSchema } from '../../shared/task-workflow/workflow-execution-context'
import { workflowTestVectors } from '../../shared/task-workflow/workflow.test-fixture'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { taskDockerConfiguration, type TaskDockerRecord } from './task-docker-configuration'
import { dockerArgs, taskDockerFixture } from './task-docker-boundary.test-fixture'
import { prepareTaskOutputWorkspace } from './task-output-workspace'

export function testerWorkflowContext() {
  const handoff = workflowTestVectors.examples.handoff
  return WorkflowExecutionContextSchema.parse({
    kind: 'workflow.execution-context',
    binding: handoff.binding,
    definitionDigest: 'a'.repeat(64),
    stageRef: handoff.consumer.stageRef,
    employeeRef: handoff.consumer.employeeRef,
    role: 'tester',
    handoffRefs: [handoff.handoffRef],
    codeInput: {
      producer: handoff.producer,
      version: {
        kind: 'snapshot',
        snapshot: handoff.artifact,
        treeDigest: handoff.codeVersion?.treeDigest ?? 'b'.repeat(64)
      }
    }
  })
}

export async function testerDockerFixture() {
  const base = await taskDockerFixture(
    resolve('logs/paperclip-development/p3/role-handoffs/docker-tester/tmp')
  )
  const output = await prepareTaskOutputWorkspace({
    workspace: base.options.record.workspace,
    assertCurrent: base.options.assertCurrent
  })
  const record: TaskDockerRecord = {
    ...base.options.record,
    command: { ...base.options.record.command, workflowContext: testerWorkflowContext() },
    workspace: { ...base.options.record.workspace, outputDirectory: output.outputDirectory }
  }
  const originalRun = base.run.getMockImplementation()
  if (!originalRun) {
    throw new Error('Missing original Docker fixture runner')
  }
  const run = vi.fn(async (spec: Parameters<typeof originalRun>[0]) => {
    const result = await originalRun(spec)
    const args = dockerArgs(spec)
    if (args[0] === 'create') {
      const mounts = args.flatMap((arg, index) => {
        if (arg !== '--mount') {
          return []
        }
        const fields = Object.fromEntries(
          args[index + 1].split(',').map((field) => {
            const [key, value] = field.split('=')
            return [key, value ?? 'true']
          })
        )
        return [
          { source: fields.source, target: fields.target, readonly: fields.readonly === 'true' }
        ]
      })
      const container = base.container()
      container.HostConfig.Mounts = mounts.map((mount) => ({
        Type: 'bind',
        Source: mount.source,
        Target: mount.target,
        ReadOnly: mount.readonly
      }))
      container.Mounts = mounts.map((mount) => ({
        Type: 'bind',
        Source: mount.source,
        Destination: mount.target,
        RW: !mount.readonly,
        Propagation: 'rprivate'
      }))
    }
    return result
  })
  const options = { ...base.options, record, run }
  return {
    ...base,
    options,
    record,
    output,
    run,
    configuration: () => taskDockerConfiguration(options),
    boundary: () => createTaskDockerBoundary(options)
  }
}
