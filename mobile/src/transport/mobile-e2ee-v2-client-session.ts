import * as ExpoCrypto from 'expo-crypto'
import { RuntimeE2EEClientSession } from '../../../src/shared/runtime-e2ee-client-session'

export type MobileE2EEV2ClientSession = RuntimeE2EEClientSession
export const MobileE2EEV2ClientSession = {
  create(args: Parameters<typeof RuntimeE2EEClientSession.create>[0]): RuntimeE2EEClientSession {
    return RuntimeE2EEClientSession.create({ ...args, randomBytes: ExpoCrypto.getRandomBytes })
  }
}
