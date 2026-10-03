import { SettingsManager } from './node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js'

export async function persistHiveModelSelection(event, cwd, environment = process.env) {
  if (!['set', 'cycle'].includes(event.source) || event.model.provider !== 'hivecode') {
    return
  }
  if (!environment.PI_CODING_AGENT_DIR) {
    throw new Error('Hive model preference requires account-scoped storage')
  }
  const models = JSON.parse(environment.HIVECODE_AI_MODELS ?? '[]')
  if (!models.some((model) => model.id === event.model.id)) {
    throw new Error('Cannot save an unauthorized Hive model preference')
  }
  const settings = SettingsManager.create(cwd, environment.PI_CODING_AGENT_DIR)
  settings.setDefaultModelAndProvider('hivecode', event.model.id)
  await settings.flush()
  if (settings.drainErrors().length > 0) {
    throw new Error('Could not save the Hive model preference')
  }
}

export function hiveModelPreferenceArgs(args, environment = process.env, cwd = process.cwd()) {
  if (!environment.HIVECODE_AI_MODELS) {
    return []
  }
  // Pi owns explicit choices and the model recorded in a resumed session.
  if (
    args.some((arg) =>
      [
        '--model',
        '--session',
        '--session-id',
        '--fork',
        '--continue',
        '-c',
        '--resume',
        '-r'
      ].includes(arg)
    )
  ) {
    return []
  }
  const models = JSON.parse(environment.HIVECODE_AI_MODELS)
  const settings = SettingsManager.create(cwd, environment.PI_CODING_AGENT_DIR)
  const saved =
    settings.getDefaultProvider() === 'hivecode' ? settings.getDefaultModel() : undefined
  const selected = saved ?? (environment.HIVECODE_AI_DEFAULT_MODEL || models[0]?.id)
  if (!models.some((model) => model.id === selected)) {
    throw new Error(
      `Saved Hive model ${selected} is unavailable. Select an authorized model with --model.`
    )
  }
  return ['--model', selected]
}
