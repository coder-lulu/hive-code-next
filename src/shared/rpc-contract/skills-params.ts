import { z } from 'zod'
import { SkillDiscoveryTargetSchema } from '../skills'

export const SkillsDiscoverParams = SkillDiscoveryTargetSchema.default({})
export const SkillsCancelInstallParams = z.object({ operationId: z.string().min(1).max(128) }).strict()
export const SkillsGetInstallProgressParams = z.object({ operationId: z.string().min(1).max(128) }).strict()
