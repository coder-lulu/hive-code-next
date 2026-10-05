import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { TaskDigest, TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import type { TaskDockerConfiguration, TaskDockerRecord } from './task-docker-configuration'

export const TaskDockerDaemonSchema = z.strictObject({
  ID: z.string().min(1).max(160),
  OSType: z.literal('linux'),
  Architecture: z.enum(['amd64', 'x86_64']),
  ServerVersion: z.string().min(1).max(80)
})
export type TaskDockerDaemonIdentity = z.infer<typeof TaskDockerDaemonSchema>
export const TaskDockerIdentitySchema = z.strictObject({
  dockerPath: z
    .string()
    .min(1)
    .max(4096)
    .refine((path) => isAbsolute(path) && !/[\0\r\n]/.test(path)),
  endpoint: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !/[\0\r\n]/.test(value)),
  imageId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  name: z.string().regex(/^hive-task-[0-9a-f]{64}$/),
  labels: z.strictObject({
    'io.hive.task.runtime': TaskOpaqueRef,
    'io.hive.task.ownership-epoch': z
      .string()
      .max(16)
      .regex(/^[1-9][0-9]*$/),
    'io.hive.task.execution': TaskOpaqueRef,
    'io.hive.task.execution-epoch': z
      .string()
      .max(16)
      .regex(/^[1-9][0-9]*$/),
    'io.hive.task.command-fingerprint': TaskDigest,
    'io.hive.task.workspace': TaskDigest
  }),
  daemon: TaskDockerDaemonSchema,
  containerId: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/)
    .nullable()
})
export type TaskDockerIdentity = z.infer<typeof TaskDockerIdentitySchema>

export function taskDockerBinding(record: TaskDockerRecord) {
  const { runtimeRecordId, ownershipEpoch, executionId, executionEpoch } = record.command
  const digest = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return {
    name: `hive-task-${digest([runtimeRecordId, ownershipEpoch, executionId, executionEpoch, record.commandFingerprint])}`,
    labels: Object.freeze({
      'io.hive.task.runtime': runtimeRecordId,
      'io.hive.task.ownership-epoch': String(ownershipEpoch),
      'io.hive.task.execution': executionId,
      'io.hive.task.execution-epoch': String(executionEpoch),
      'io.hive.task.command-fingerprint': record.commandFingerprint,
      'io.hive.task.workspace': digest([
        record.workspace.workspaceId,
        record.workspace.executionPath,
        record.workspace.directoryIdentity
      ])
    })
  }
}

export function taskDockerIdentityMatchesRecord(
  identity: TaskDockerIdentity,
  record: TaskDockerRecord
): boolean {
  const binding = taskDockerBinding(record)
  return (
    !!record.workspace.directoryIdentity &&
    identity.name === binding.name &&
    isDeepStrictEqual(identity.labels, binding.labels)
  )
}

/** A durable identity records observations; it grants no task, account or owner authority. */
export function taskDockerIdentityFor(
  config: TaskDockerConfiguration,
  daemon: TaskDockerDaemonIdentity,
  containerId: string | null
): TaskDockerIdentity {
  return TaskDockerIdentitySchema.parse({
    dockerPath: config.dockerPath,
    endpoint: config.endpoint,
    imageId: config.imageId,
    name: config.name,
    labels: config.labels,
    daemon,
    containerId
  })
}
