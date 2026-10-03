import { ipcMain } from 'electron'
import {
  parseConsumptionQuery,
  type ConsumptionQuery,
  type HiveAiConsumptionSnapshot
} from '../../shared/hive-ai-consumption'
import type { HiveAiAccountSnapshot, HiveAiBenefitsSnapshot } from '../../shared/hive-ai-account'
import type { HiveAiModelCandidatesSnapshot } from '../../shared/hive-ai-model-candidates'
import {
  hiveAiModelSelectionCommandSchema,
  type HiveAiModelCatalogSnapshot,
  type HiveAiModelSelection
} from '../../shared/hive-ai-model-catalog'

export function registerHiveAiAccountHandler(service: {
  readAiConsumption?: (query: ConsumptionQuery) => Promise<HiveAiConsumptionSnapshot>
  activateAiAccount?: () => Promise<Pick<HiveAiAccountSnapshot, 'accountId' | 'account'>>
  readAiAccount?: () => Promise<HiveAiAccountSnapshot>
  readAiBenefits?: () => Promise<HiveAiBenefitsSnapshot>
  readAiModelCandidates?: () => Promise<HiveAiModelCandidatesSnapshot>
  readAiModels?: () => Promise<HiveAiModelCatalogSnapshot>
  selectAiModel?: (command: HiveAiModelSelection) => Promise<HiveAiModelCatalogSnapshot>
}): void {
  ipcMain.handle('hiveAccount:readAiConsumption', (_event, ...args: unknown[]) => {
    if (args.length !== 1 || !service.readAiConsumption) {
      throw new Error('hive_ai_account_unavailable')
    }
    return service.readAiConsumption(parseConsumptionQuery(args[0]))
  })
  ipcMain.handle('hiveAccount:readAiModels', (_event, ...args: unknown[]) => {
    if (args.length || !service.readAiModels) {
      throw new Error('hive_ai_account_unavailable')
    }
    return service.readAiModels()
  })
  ipcMain.handle('hiveAccount:selectAiModel', (_event, ...args: unknown[]) => {
    if (args.length !== 1 || !service.selectAiModel) {
      throw new Error('hive_ai_account_unavailable')
    }
    const command = hiveAiModelSelectionCommandSchema.safeParse(args[0])
    if (!command.success) {
      throw new Error('hive_ai_invalid_model_selection')
    }
    return service.selectAiModel(command.data)
  })
  ipcMain.handle('hiveAccount:activateAiAccount', (_event, ...args: unknown[]) => {
    if (args.length || !service.activateAiAccount) {
      throw new Error('hive_ai_account_unavailable')
    }
    return service.activateAiAccount()
  })
  ipcMain.handle('hiveAccount:readAiAccount', (_event, ...args: unknown[]) => {
    if (args.length || !service.readAiAccount) {
      throw new Error('hive_ai_account_unavailable')
    }
    return service.readAiAccount()
  })
  ipcMain.handle('hiveAccount:readAiModelCandidates', (_event, ...args: unknown[]) => {
    if (args.length || !service.readAiModelCandidates) {
      throw new Error('hive_ai_account_unavailable')
    }
    return service.readAiModelCandidates()
  })
  ipcMain.handle('hiveAccount:readAiBenefits', (_event, ...args: unknown[]) => {
    if (args.length || !service.readAiBenefits) {
      throw new Error('hive_ai_account_unavailable')
    }
    return service.readAiBenefits()
  })
}
