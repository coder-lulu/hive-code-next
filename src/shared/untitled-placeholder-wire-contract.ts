import { z } from 'zod'

export const untitledPlaceholderLeaseTokenSchema = z.string().min(1).max(256).nullable()

const placeholderRecovery = z
  .object({
    id: z.string().min(1),
    originalPath: z.string().min(1),
    retainedPath: z.string().min(1),
    manifestPath: z.string().min(1),
    restoredToOriginalPath: z.boolean()
  })
  .strict()

export const untitledPlaceholderDiscardResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('removed-placeholder'), recovery: placeholderRecovery }).strict(),
  z
    .object({
      status: z.literal('preserved'),
      reason: z.enum([
        'not-empty',
        'identity-changed',
        'not-regular-file',
        'hard-linked',
        'source-recreated'
      ]),
      recovery: placeholderRecovery.optional()
    })
    .strict(),
  z
    .object({
      status: z.literal('recovery-required'),
      reason: z.enum(['restore-failed', 'capture-outcome-unknown', 'manifest-or-proof-failed']),
      recovery: placeholderRecovery
    })
    .strict(),
  z
    .object({
      status: z.literal('unavailable'),
      reason: z.enum([
        'lease-unavailable',
        'lease-owner-mismatch',
        'path-mismatch',
        'filesystem-unavailable',
        'host-capability-unavailable'
      ])
    })
    .strict()
])
