import { z } from 'zod'

export const HiveRuntimeClaimPollParams = z.object({ challengeId: z.string().uuid() }).strict()
export const HiveRuntimeResetIdentityParams = z.object({ confirm: z.literal(true) }).strict()
