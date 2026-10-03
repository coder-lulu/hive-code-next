import { z } from 'zod'
import { hiveAgentSessionAggregateSchema } from './hive-agent-session-aggregate'

const identity = z.string().min(1).max(512)
export const hiveAgentSessionEntrySchema = z
  .strictObject({
    aggregate: hiveAgentSessionAggregateSchema,
    accountId: identity,
    deviceId: identity,
    projectScope: identity,
    deletedAt: z.number().int().nonnegative().optional(),
    deleteOperationId: z
      .string()
      .regex(/^\d{13}-[0-9a-f]{32}$/)
      .optional(),
    deletionComplete: z.boolean().optional()
  })
  .refine(
    (entry) =>
      (entry.deletedAt === undefined) === (entry.deleteOperationId === undefined) &&
      (!entry.deletionComplete ||
        (entry.deletedAt !== undefined &&
          !entry.aggregate.binding &&
          !entry.aggregate.turn &&
          !entry.aggregate.generation)),
    { message: 'Invalid deletion state' }
  )
export type HiveAgentSessionEntry = z.infer<typeof hiveAgentSessionEntrySchema>
