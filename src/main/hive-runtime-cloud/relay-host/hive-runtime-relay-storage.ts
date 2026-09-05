import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { readdirSync, mkdirSync, lstatSync } from 'node:fs'
import {
  readHiveRuntimeServiceOwnedJson,
  deleteHiveRuntimeServiceOwnedJson,
  writeHiveRuntimeServiceOwnedJson
} from '../hive-runtime-cloud-service-owned-json'
import type { HiveRuntimeRelayBindingStore } from './hive-runtime-relay-authorization-provider'
import { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import type { HiveRuntimeRelayHostBinding } from './hive-runtime-relay-types'
import { isHiveRuntimeRelayTransitionState } from './hive-runtime-relay-session-transition-validation'

function secureDirectory(directory: string): void {
  const parent = dirname(directory)
  if (parent !== directory) {
    secureDirectory(parent)
  }
  try {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('hive_runtime_relay_storage_unsafe')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    mkdirSync(directory, { mode: 0o700 })
  }
}

type FenceReceipt = {
  version: 'hiverelay-boot-retirement/v1'
  runtimeRecordId: string
  runtimeInstanceId: string
  retiredCount: number
  retiredPayloadCount: number
  chainDigest: string
  latest: null | {
    oldBootId: string
    newBootId: string
    payloadDigest: string
    payloadCount: number
    authorityId: string
    authorityGeneration: number
    leaseEpoch: number
    fencingEpoch: number
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const identifier = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
function isReceipt(v: unknown): v is FenceReceipt {
  if (
    !object(v) ||
    Object.keys(v).length !== 7 ||
    v.version !== 'hiverelay-boot-retirement/v1' ||
    !identifier(v.runtimeRecordId) ||
    !identifier(v.runtimeInstanceId) ||
    !integer(v.retiredCount) ||
    !integer(v.retiredPayloadCount) ||
    !digest(v.chainDigest)
  ) {
    return false
  }
  if (v.latest === null) {
    return v.retiredCount === 0 && v.retiredPayloadCount === 0
  }
  const last = v.latest
  return (
    v.retiredCount > 0 &&
    object(last) &&
    Object.keys(last).length === 8 &&
    identifier(last.oldBootId) &&
    identifier(last.newBootId) &&
    last.oldBootId !== last.newBootId &&
    digest(last.payloadDigest) &&
    integer(last.payloadCount) &&
    last.payloadCount <= 1024 &&
    identifier(last.authorityId) &&
    integer(last.authorityGeneration) &&
    integer(last.leaseEpoch) &&
    integer(last.fencingEpoch)
  )
}

function fileKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function createHiveRuntimeRelayBindingStore(
  directory: string
): HiveRuntimeRelayBindingStore {
  secureDirectory(resolve(directory))
  return {
    read(runtimeRecordId) {
      const read = readHiveRuntimeServiceOwnedJson(
        join(directory, `${fileKey(runtimeRecordId)}.binding.json`),
        (value): value is HiveRuntimeRelayHostBinding => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false
          }
          const v = value as Record<string, unknown>
          return (
            Object.keys(v).length === 3 &&
            typeof v.relayHostId === 'string' &&
            /^[A-Za-z0-9_-]{16}$/.test(v.relayHostId) &&
            typeof v.hostBindingVersion === 'number' &&
            Number.isSafeInteger(v.hostBindingVersion) &&
            v.hostBindingVersion > 0 &&
            typeof v.hostPublicKeyB64 === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(v.hostPublicKeyB64)
          )
        }
      )
      if (read.status === 'unreadable') {
        throw new Error('hive_runtime_relay_binding_unreadable')
      }
      return read.status === 'ok' ? read.value : null
    },
    write(runtimeRecordId, binding) {
      if (
        !writeHiveRuntimeServiceOwnedJson(
          join(directory, `${fileKey(runtimeRecordId)}.binding.json`),
          binding
        )
      ) {
        throw new Error('hive_runtime_relay_binding_write_failed')
      }
    }
  }
}

export function openHiveRuntimeRelayOutbox(
  directory: string,
  context: CurrentHiveRuntimeCloudLeaseContext
): HiveRuntimeRelaySessionTransitionOutbox {
  const { runtimeInstanceId, bootId } = context.tuple
  secureDirectory(resolve(directory))
  const filename = `${fileKey(`${runtimeInstanceId}\n${bootId}`)}.outbox.json`
  const previous = readdirSync(directory).filter((name) => name.endsWith('.outbox.json'))
  const receiptPath = join(directory, 'boot-retirement.json')
  const read = readHiveRuntimeServiceOwnedJson(receiptPath, isReceipt)
  if (read.status === 'unreadable') {
    throw new Error('hive_runtime_relay_retirement_corrupt')
  }
  let receipt: FenceReceipt =
    read.status === 'ok'
      ? read.value
      : {
          version: 'hiverelay-boot-retirement/v1',
          runtimeRecordId: context.tuple.runtimeRecordId,
          runtimeInstanceId,
          retiredCount: 0,
          retiredPayloadCount: 0,
          chainDigest: fileKey(''),
          latest: null
        }
  if (
    receipt.runtimeRecordId !== context.tuple.runtimeRecordId ||
    receipt.runtimeInstanceId !== runtimeInstanceId
  ) {
    throw new Error('hive_runtime_relay_retirement_scope_mismatch')
  }
  // Validate every file before mutating anything; a new lease fences only this Runtime's old boots.
  const states = previous.map((name) => {
    if (!/^[a-f0-9]{64}\.outbox\.json$/.test(name)) {
      throw new Error('hive_runtime_relay_outbox_corrupt')
    }
    const state = readHiveRuntimeServiceOwnedJson(
      join(directory, name),
      isHiveRuntimeRelayTransitionState,
      1_048_576
    )
    if (
      state.status !== 'ok' ||
      state.value.runtimeId !== runtimeInstanceId ||
      name !== `${fileKey(`${state.value.runtimeId}\n${state.value.runtimeBootId}`)}.outbox.json`
    ) {
      throw new Error('hive_runtime_relay_outbox_corrupt')
    }
    if (read.status === 'missing' && state.value.runtimeBootId !== bootId) {
      throw new Error('hive_runtime_relay_retirement_scope_unproven')
    }
    return { name, state: state.value }
  })
  if (!writeHiveRuntimeServiceOwnedJson(receiptPath, receipt)) {
    throw new Error('hive_runtime_relay_retirement_write_failed')
  }
  for (const { name, state } of states) {
    if (state.runtimeBootId === bootId) {
      continue
    }
    const payloadDigest = fileKey(JSON.stringify(state))
    if (receipt.latest?.oldBootId === state.runtimeBootId) {
      if (receipt.latest.payloadDigest !== payloadDigest) {
        throw new Error('hive_runtime_relay_retirement_conflict')
      }
    } else {
      const latest = {
        oldBootId: state.runtimeBootId,
        newBootId: bootId,
        payloadDigest,
        payloadCount: state.entries.length,
        authorityId: context.authorityId,
        authorityGeneration: context.tuple.authorityGeneration,
        leaseEpoch: context.tuple.leaseEpoch,
        fencingEpoch: context.tuple.fencingEpoch
      }
      receipt = {
        ...receipt,
        retiredCount: receipt.retiredCount + 1,
        retiredPayloadCount: receipt.retiredPayloadCount + state.entries.length,
        chainDigest: fileKey(`${receipt.chainDigest}\n${JSON.stringify(latest)}`),
        latest
      }
      if (!isReceipt(receipt) || !writeHiveRuntimeServiceOwnedJson(receiptPath, receipt)) {
        throw new Error('hive_runtime_relay_retirement_write_failed')
      }
    }
    // This is BOOT_ROTATED authority retirement, never a fabricated transition ACK/verdict.
    deleteHiveRuntimeServiceOwnedJson(join(directory, name))
  }
  return new HiveRuntimeRelaySessionTransitionOutbox({
    path: join(directory, filename),
    runtimeId: runtimeInstanceId,
    runtimeBootId: bootId
  })
}
