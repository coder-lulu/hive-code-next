import { RuntimeClientError } from '../../runtime-client'
import { APP_DISPLAY_NAME, PRIMARY_CLI_COMMAND } from '../../../shared/brand'

export function resolveCompatibilityCliCommand():
  | typeof PRIMARY_CLI_COMMAND
  | 'hivecode'
  | 'orca'
  | 'orca-ide'
  | 'orca-dev' {
  const configured = process.env.ORCA_CLI_COMMAND
  if (
    configured === PRIMARY_CLI_COMMAND ||
    configured === 'hivecode' ||
    configured === 'orca' ||
    configured === 'orca-ide' ||
    configured === 'orca-dev'
  ) {
    return configured
  }
  return PRIMARY_CLI_COMMAND
}

export function resolvePackagedWindowsCompatibilityCommand():
  | typeof PRIMARY_CLI_COMMAND
  | 'hivecode'
  | 'orca'
  | 'orca-ide'
  | undefined {
  if (process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.ORCA_CLI_COMMAND
  if (
    command === PRIMARY_CLI_COMMAND ||
    command === 'hivecode' ||
    command === 'orca' ||
    command === 'orca-ide'
  ) {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    `The packaged ${APP_DISPLAY_NAME} launcher did not provide a valid resume command. No question was created.`
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.ORCA_DEV_CLI_INVOCATION === '1' ||
    (process.env.ORCA_USER_DATA_PATH?.includes('orca-dev') ?? false)
  )
}
