import { z } from 'zod'

const id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const hiveAgentLocalIdentitySchema = z.strictObject({
  contract: z.literal('hive-runtime-local-identity-v1'),
  accountId: id,
  deviceId: id,
  authorityId: z
    .string()
    .min(1)
    .max(128)
    .refine((value) =>
      Array.from(value).every((character) => character >= ' ' && character !== '\u007f')
    ),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
export type HiveAgentLocalIdentity = Readonly<z.infer<typeof hiveAgentLocalIdentitySchema>>
