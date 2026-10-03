import { describe, expect, it, vi } from 'vitest'
import {
  clearCloudLaunchCredentialFromAddressBar,
  readCloudLaunchFragment
} from './cloud-launch-fragment'

const ticketId = '123e4567-e89b-42d3-a456-426614174000'
const launchSecret = 'A'.repeat(43)
const documentTitle = 'Runtime Client'

describe('cloud launch fragment', () => {
  it('accepts only the exact launch fragment credential', () => {
    expect(
      readCloudLaunchFragment({ hash: `#launch=${ticketId}.${launchSecret}`, search: '' })
    ).toEqual({
      kind: 'valid',
      credential: { ticketId, launchSecret }
    })
  })

  it('reports locations without a launch credential as absent', () => {
    expect(readCloudLaunchFragment({ hash: '', search: '' })).toEqual({ kind: 'absent' })
    expect(
      readCloudLaunchFragment({ hash: '#pair=not-a-launch', search: '?source=email' })
    ).toEqual({ kind: 'absent' })
  })

  it.each([
    [`#launch=${ticketId}.${launchSecret}&extra=value`, ''],
    [`#extra=value&launch=${ticketId}.${launchSecret}`, ''],
    [`#launch=${ticketId}.${launchSecret}&launch=${ticketId}.${launchSecret}`, ''],
    [`#launch=${ticketId.toUpperCase()}.${launchSecret}`, ''],
    [`#launch=${ticketId}.too-short`, ''],
    [`#launch=${ticketId}.${'B'.repeat(43)}`, ''],
    [`#launch=${ticketId}.${launchSecret}=`, ''],
    ['#la%75nch=invalid', ''],
    ['', `?launch=${ticketId}.${launchSecret}`],
    [`#launch=${ticketId}.${launchSecret}`, `?launch=${ticketId}.${launchSecret}`]
  ])('fails closed for a malformed or misplaced launch credential', (hash, search) => {
    expect(readCloudLaunchFragment({ hash, search })).toEqual({ kind: 'invalid' })
  })

  it('synchronously removes launch material from the address bar', () => {
    const replaceState = vi.fn()

    const result = clearCloudLaunchCredentialFromAddressBar({
      location: {
        hash: `#launch=${ticketId}.${launchSecret}`,
        origin: 'https://runtime.example',
        pathname: '/web/',
        search: '?source=email'
      },
      history: { replaceState },
      documentTitle
    })

    expect(result).toBeUndefined()
    expect(replaceState).toHaveBeenCalledOnce()
    expect(replaceState).toHaveBeenCalledWith(null, documentTitle, 'https://runtime.example/web/')
  })
})
