import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { TaskDockerConfiguration } from './task-docker-configuration'
import { taskLaunchPathKey } from './task-launch-workspace'
import { refuseTaskExecution } from './task-execution-error'

const SourcePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => isAbsolute(path) && !/[,\0\r\n]/.test(path))
export const TaskDockerGuestMountSchema = z.strictObject({
  Type: z.literal('bind'),
  Source: SourcePath,
  Destination: z.enum(['/workspace', '/outputs']),
  RW: z.boolean(),
  Propagation: z.literal('rprivate'),
  Name: z.literal('').optional(),
  Driver: z.literal('').optional(),
  Mode: z.enum(['', 'rw', 'ro']).optional()
})
export const TaskDockerHostMountSchema = z.strictObject({
  Type: z.literal('bind'),
  Source: SourcePath,
  Target: z.enum(['/workspace', '/outputs']),
  ReadOnly: z.boolean().optional(),
  Consistency: z.literal('').optional(),
  BindOptions: z
    .strictObject({
      Propagation: z.enum(['', 'rprivate']).optional(),
      NonRecursive: z.literal(false).optional(),
      CreateMountpoint: z.literal(false).optional(),
      ReadOnlyNonRecursive: z.literal(false).optional(),
      ReadOnlyForceRecursive: z.literal(false).optional()
    })
    .optional()
})

export function assertTaskDockerMounts(
  container: {
    Mounts: z.infer<typeof TaskDockerGuestMountSchema>[]
    HostConfig: { Mounts: z.infer<typeof TaskDockerHostMountSchema>[] }
  },
  expected: TaskDockerConfiguration
): void {
  const mounts = [
    {
      path: expected.workspace.executionPath,
      target: '/workspace',
      readOnly: expected.codeReadOnly
    }
  ]
  if (expected.workspace.outputDirectory) {
    mounts.push({
      path: expected.workspace.outputDirectory.path,
      target: '/outputs',
      readOnly: false
    })
  }
  if (
    container.Mounts.length !== mounts.length ||
    container.HostConfig.Mounts.length !== mounts.length
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  for (const mount of mounts) {
    const guest = container.Mounts.find((item) => item.Destination === mount.target)
    const host = container.HostConfig.Mounts.find((item) => item.Target === mount.target)
    if (
      !guest ||
      !host ||
      taskLaunchPathKey(guest.Source) !== taskLaunchPathKey(mount.path) ||
      taskLaunchPathKey(host.Source) !== taskLaunchPathKey(mount.path) ||
      guest.RW !== !mount.readOnly ||
      Boolean(host.ReadOnly) !== mount.readOnly ||
      (guest.Mode && guest.Mode !== (mount.readOnly ? 'ro' : 'rw'))
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
}
