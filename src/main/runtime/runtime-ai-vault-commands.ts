import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'
import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../shared/ai-vault-resume-preparation'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../../shared/ai-vault-session-title'
import type { AiVaultListArgs, AiVaultListResult } from '../../shared/ai-vault-types'
import { listAiVaultSessions } from '../ai-vault/cached-session-list'
import { resolveLocalAiVaultSessionTitles } from '../ai-vault/session-title-resolver'

export class RuntimeAiVaultCommands {
  constructor(
    private readonly getPrepareResume: () =>
      | ((args: AiVaultPrepareSessionResumeArgs) => Promise<AiVaultPrepareSessionResumeResult>)
      | null
  ) {}

  list(args?: AiVaultListArgs): Promise<AiVaultListResult> {
    return listAiVaultSessions(args)
  }

  resolveTitles(
    requests: AiVaultSessionTitleRequest[],
    signal?: AbortSignal
  ): Promise<AiVaultSessionTitlesResult> {
    return resolveLocalAiVaultSessionTitles(requests, signal)
  }

  async prepare(args: AiVaultPrepareSessionResumeArgs): Promise<AiVaultPrepareSessionResumeResult> {
    const result = await (this.getPrepareResume()?.(args) ?? { useRealCodexHome: false })
    if (!args.checkRecordedCwd || !args.sessionId || args.executionHostId !== 'local') {
      return result
    }
    // The current host's scanner establishes the transcript identity and directory. The client
    // supplies no path to probe; spoofed/mismatched sessions cannot turn this into filesystem RPC.
    const catalog = await this.list({ unlimited: true })
    const matches = catalog.sessions.filter(
      (session) =>
        session.executionHostId === 'local' &&
        session.agent === args.agent &&
        session.sessionId === args.sessionId &&
        session.filePath === args.filePath &&
        session.codexHome === args.codexHome
    )
    if (matches.length !== 1 || !matches[0].cwd || !isAbsolute(matches[0].cwd)) {
      return result
    }
    try {
      await stat(matches[0].cwd)
      return { ...result, recordedCwdMissing: false }
    } catch (error) {
      if (!isDefinitiveAbsence(error)) {
        throw error
      }
      return { ...result, recordedCwdMissing: true }
    }
  }
}
