import { z } from 'zod'

const ProcessDeathSchema = z
  .object({
    kind: z.enum(['exit-observed', 'pid-absent', 'identity-mismatch']),
    detail: z.string().min(1).max(512),
    observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ownerFence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    lastProvenAliveAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    runtimeEnd: z.string().min(1).max(512).optional()
  })
  .refine(
    (value) => value.lastProvenAliveAt === undefined || value.lastProvenAliveAt <= value.observedAt
  )
export type AgentSessionDeathEvidence = z.infer<typeof ProcessDeathSchema>

export function isAgentSessionDeathEvidence(value: unknown): value is AgentSessionDeathEvidence {
  return ProcessDeathSchema.safeParse(value).success
}
