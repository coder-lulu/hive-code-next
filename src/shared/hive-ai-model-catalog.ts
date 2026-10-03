import { z } from 'zod'

export const hiveAiProtocolSchema = z.enum(['CHAT_COMPLETIONS', 'RESPONSES'])
const snapshotRevision = z.string().regex(/^[a-f0-9]{64}$/)
const modelSchema = z
  .strictObject({
    modelId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),
    contextWindow: z.number().int().positive().max(2147483647).nullable(),
    maxOutputTokens: z.number().int().positive().max(2147483647).nullable(),
    protocols: z
      .array(hiveAiProtocolSchema)
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length)
  })
  .refine(
    (model) =>
      (model.contextWindow === null && model.maxOutputTokens === null) ||
      (model.contextWindow !== null &&
        model.maxOutputTokens !== null &&
        model.maxOutputTokens < model.contextWindow)
  )
const catalogSchema = z
  .strictObject({
    snapshotRevision,
    asOf: z
      .string()
      .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/)
      .refine((value) => Number.isFinite(Date.parse(value))),
    scope: z.literal('ACCOUNT'),
    models: z.array(modelSchema).max(100)
  })
  .refine(
    (catalog) =>
      new Set(catalog.models.map((model) => model.modelId)).size === catalog.models.length
  )
export const hiveAiModelSelectionCommandSchema = z.strictObject({
  modelId: modelSchema.shape.modelId,
  protocol: hiveAiProtocolSchema,
  snapshotRevision
})
export type HiveAiProtocol = z.infer<typeof hiveAiProtocolSchema>
export type HiveAiCatalogModel = z.infer<typeof modelSchema>
export type HiveAiModelCatalog = z.infer<typeof catalogSchema>
export type HiveAiModelSelection = z.infer<typeof hiveAiModelSelectionCommandSchema>
export type HiveAiModelCatalogSnapshot = {
  accountId: string
  catalog: HiveAiModelCatalog
  selection: HiveAiModelSelection | null
}

export function parseHiveAiModelCatalog(value: unknown): HiveAiModelCatalog {
  const result = catalogSchema.safeParse(value)
  if (!result.success) {
    throw new Error('hive_ai_invalid_catalog')
  }
  return result.data
}

/** Selection is a preference; every actual dispatch still requires current server authorization. */
export function selectHiveAiModel(input: {
  catalog: unknown
  modelId: string | null
  protocol: string | null
  expectedSnapshotRevision: string
  generationState: string | null
}): HiveAiModelSelection {
  if (
    input.generationState !== null &&
    !['COMPLETED', 'FAILED', 'CANCELLED'].includes(input.generationState)
  ) {
    throw new Error('hive_ai_generation_not_terminal')
  }
  const catalog = parseHiveAiModelCatalog(input.catalog)
  if (catalog.snapshotRevision !== input.expectedSnapshotRevision) {
    throw new Error('hive_ai_stale_catalog')
  }
  if (input.modelId === null || input.protocol === null) {
    throw new Error('hive_ai_model_selection_required')
  }
  const model = catalog.models.find((item) => item.modelId === input.modelId)
  if (!model) {
    throw new Error('hive_ai_model_unavailable')
  }
  const protocol = hiveAiProtocolSchema.safeParse(input.protocol)
  if (!protocol.success || !model.protocols.includes(protocol.data)) {
    throw new Error('hive_ai_model_incompatible')
  }
  return {
    modelId: model.modelId,
    protocol: protocol.data,
    snapshotRevision: catalog.snapshotRevision
  }
}
