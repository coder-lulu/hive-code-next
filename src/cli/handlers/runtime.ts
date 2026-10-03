import type {
  HiveLocalRuntimeClaimPollResult,
  HiveLocalRuntimeClaimStartResult,
  HiveLocalRuntimeCloudStatus,
  HiveLocalRuntimeIdentityResetResult
} from '../../shared/hive-runtime-cloud'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

const MAXIMUM_POLL_DELAY_MS = 30_000
const MINIMUM_POLL_DELAY_MS = 250

function rejectRemoteSelectionFlags(ctx: HandlerContext, command: string): void {
  for (const flag of ['environment', 'pairing-code']) {
    if (ctx.flags.has(flag)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `\`--${flag}\` does not retarget \`${command}\`. Run it on the machine whose Runtime installation you want to manage.`
      )
    }
  }
}

function formatRuntimeCloudStatus(status: HiveLocalRuntimeCloudStatus): string {
  return [
    `ownership: ${status.ownership}`,
    `presence: ${status.presence}`,
    `runtimeRecordId: ${status.runtimeRecordId ?? 'none'}`,
    `relay: ${status.relay}`
  ].join('\n')
}

function formatClaimResult(
  result: HiveLocalRuntimeClaimStartResult | HiveLocalRuntimeClaimPollResult
): string {
  if (result.status === 'CLAIMED') {
    return `Runtime claimed to your Hive account.\nruntimeRecordId: ${result.runtimeRecordId}`
  }
  if (result.status === 'EXPIRED') {
    return 'Runtime claim challenge expired. Run `hive runtime claim` to start again.'
  }
  if ('userCode' in result) {
    return [
      'Runtime claim approval is pending.',
      `Open: ${result.verificationUri}`,
      `Enter code: ${result.userCode}`,
      `challengeId: ${result.challengeId}`,
      `expiresAt: ${new Date(result.expiresAt).toISOString()}`
    ].join('\n')
  }
  return `Runtime claim approval is pending.\nchallengeId: ${result.challengeId}`
}

function showClaimInstructions(
  result: Extract<HiveLocalRuntimeClaimStartResult, { status: 'PENDING' }>
): void {
  process.stderr.write(
    `Claim this Runtime at ${result.verificationUri}\nUser code: ${result.userCode}\nWaiting for approval...\n`
  )
}

function pollDelayMs(nextPollAt: number | undefined, fallbackSeconds: number): number {
  if (nextPollAt !== undefined) {
    return Math.max(MINIMUM_POLL_DELAY_MS, nextPollAt - Date.now())
  }
  return Math.min(MAXIMUM_POLL_DELAY_MS, Math.max(MINIMUM_POLL_DELAY_MS, fallbackSeconds * 1_000))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function claimRuntime(ctx: HandlerContext): Promise<void> {
  rejectRemoteSelectionFlags(ctx, 'hive runtime claim')
  const started = await ctx.client.call<HiveLocalRuntimeClaimStartResult>('cloudRuntime.claim')
  if (started.result.status === 'CLAIMED') {
    printResult(started, ctx.json, formatClaimResult)
    return
  }

  showClaimInstructions(started.result)
  let nextPollAt: number | undefined
  while (Date.now() < started.result.expiresAt) {
    const remainingMs = started.result.expiresAt - Date.now()
    await delay(Math.min(remainingMs, pollDelayMs(nextPollAt, started.result.pollIntervalSeconds)))
    if (Date.now() >= started.result.expiresAt) {
      break
    }
    const polled = await ctx.client.call<HiveLocalRuntimeClaimPollResult>(
      'cloudRuntime.claimPoll',
      { challengeId: started.result.challengeId },
      { timeoutMs: 15_000 }
    )
    if (polled.result.status === 'PENDING') {
      nextPollAt = polled.result.nextPollAt
      continue
    }
    if (polled.result.status === 'EXPIRED') {
      throw new RuntimeClientError(
        'runtime_claim_expired',
        'Runtime claim challenge expired. Run `hive runtime claim` to start again.'
      )
    }
    printResult(polled, ctx.json, formatClaimResult)
    return
  }
  throw new RuntimeClientError(
    'runtime_claim_expired',
    'Runtime claim challenge expired. Run `hive runtime claim` to start again.'
  )
}

export const RUNTIME_HANDLERS: Record<string, CommandHandler> = {
  'runtime status': async (ctx) => {
    rejectRemoteSelectionFlags(ctx, 'hive runtime status')
    const result = await ctx.client.call<HiveLocalRuntimeCloudStatus>('cloudRuntime.status')
    printResult(result, ctx.json, formatRuntimeCloudStatus)
  },
  'runtime claim': claimRuntime,
  'runtime reset-cloud-identity': async (ctx) => {
    rejectRemoteSelectionFlags(ctx, 'hive runtime reset-cloud-identity')
    const result = await ctx.client.call<HiveLocalRuntimeIdentityResetResult>(
      'cloudRuntime.resetIdentity',
      { confirm: true }
    )
    printResult(
      result,
      ctx.json,
      () => 'Hive Cloud installation identity reset. Local anonymous pairing was not changed.'
    )
  }
}
