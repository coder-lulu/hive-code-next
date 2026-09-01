import { describe, expect, it } from 'vitest'
import * as sharedControlProtocol from './remote-runtime-shared-control-protocol'

describe('remote runtime shared control protocol', () => {
  it('does not expose a binary sender on the shared control protocol surface', () => {
    expect('sendSharedControlEncryptedBinary' in sharedControlProtocol).toBe(false)
  })
})
