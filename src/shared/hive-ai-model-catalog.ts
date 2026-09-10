import { z } from 'zod'
import type { HiveAgentGeneration } from './hive-agent-session-schema'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const modelSchema = z
  .strictObject({
    modelId: id,
    displayName: z
      .string()
      .min(1)
      .max(128)
      .refine(
        (value) =>
          value.trim().length > 0 &&
          !Array.from(value).some(
            (char) =>
              char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
          )
      ),
    modelRevision: revision,
    profile: id,
    capabilities: z
      .array(id)
      .min(1)
      .max(16)
      .refine((items) => new Set(items).size === items.length),
    contextLimit: z.number().int().min(1).max(10_000_000),
    outputLimit: z.number().int().min(1).max(10_000_000)
  })
  .refine((model) => model.outputLimit <= model.contextLimit)
const catalogSchema = z
  .strictObject({
    catalogRevision: revision,
    models: z.array(modelSchema).max(1000)
  })
  .refine(
    (catalog) =>
      new Set(catalog.models.map((model) => model.modelId)).size === catalog.models.length
  )

export type HiveAiCatalogModel = z.infer<typeof modelSchema>
export type HiveAiModelCatalog = z.infer<typeof catalogSchema>

export function parseHiveAiModelCatalog(value: unknown): HiveAiModelCatalog {
  const result = catalogSchema.safeParse(value)
  if (!result.success) {
    throw new Error('hive_ai_invalid_catalog')
  }
  return result.data
}

/** Pure projection only; current Edge authorization remains mandatory for every dispatch. */
export function selectHiveAiModel(input: {
  catalog: HiveAiModelCatalog
  modelId: string | null
  expectedModelRevision: number | null
  minimumCatalogRevision: number
  activeProfiles: readonly string[]
  generationState: HiveAgentGeneration['state'] | null
}): HiveAiCatalogModel {
  if (
    input.generationState !== null &&
    !['COMPLETED', 'FAILED', 'CANCELLED'].includes(input.generationState)
  ) {
    throw new Error('hive_ai_generation_not_terminal')
  }
  const catalog = parseHiveAiModelCatalog(input.catalog)
  if (
    !Number.isSafeInteger(input.minimumCatalogRevision) ||
    input.minimumCatalogRevision < 0 ||
    catalog.catalogRevision < input.minimumCatalogRevision
  ) {
    throw new Error('hive_ai_stale_catalog')
  }
  if (input.modelId === null) {
    throw new Error('hive_ai_model_selection_required')
  }
  const model = catalog.models.find((item) => item.modelId === input.modelId)
  if (!model) {
    throw new Error('hive_ai_model_unavailable')
  }
  if (input.expectedModelRevision !== null && model.modelRevision !== input.expectedModelRevision) {
    throw new Error('hive_ai_stale_model')
  }
  if (
    !input.activeProfiles.includes(model.profile) ||
    model.capabilities.length !== 1 ||
    model.capabilities[0] !== 'text'
  ) {
    throw new Error('hive_ai_model_incompatible')
  }
  return model
}
